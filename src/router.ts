/**
 * BlueJacket Entry Point
 */

import { pathToRegexp, Key } from 'path-to-regexp';

export type ObjectWithDynamicKeys = { [key: string]: any };

export type Context<MixinInterface> = {
  route: string;
  router: BlueJacket<MixinInterface>;
  data: ObjectWithDynamicKeys;
  params?: ObjectWithDynamicKeys;
} & MixinInterface;

export type HandlerFunction<MixinInterface> = (context: Context<MixinInterface>) => any;
export type HandlerAction<MixinInterface> =
  | HandlerFunction<MixinInterface>
  | HandlerFunction<MixinInterface>[];

export type Handler<MixinInterface> = {
  action: HandlerAction<MixinInterface>;
  params: Key[];
};

interface IBlueJacket<MixinInterface = {}> {
  mixins?: MixinInterface;
  strict?: boolean;
  caseSensitive?: boolean;
  instanceKey?: string;
}

export interface BlueJacket<MixinInterface> extends IBlueJacket<MixinInterface> {}

export class BlueJacket<MixinInterface> {
  static instances = new Map<string, BlueJacket<any>>();

  private static readonly defaultOpts: IBlueJacket = {
    mixins: {},
    strict: false,
    caseSensitive: false,
  };

  private handlerList: {
    regex: RegExp;
    handlers: Handler<MixinInterface>[];
  }[] = [];

  constructor(opts: IBlueJacket = BlueJacket.defaultOpts) {
    if (opts.instanceKey && BlueJacket.instances.has(opts.instanceKey)) {
      return BlueJacket.instances.get(opts.instanceKey) as BlueJacket<MixinInterface>;
    }

    Object.assign(this, BlueJacket.defaultOpts, opts);

    if (opts.instanceKey) {
      BlueJacket.instances.set(this.instanceKey as string, this);
    }

    return this;
  }

  private isOfType(item: any, type: string): boolean {
    return Object.prototype.toString.call(item) === `[object ${type}]`;
  }

  private recursivelyTypeCheckHandlers(handlerList: HandlerAction<MixinInterface>[]) {
    handlerList.forEach((handler) => {
      if (this.isOfType(handler, 'Function') || this.isOfType(handler, 'AsyncFunction')) {
        return;
      }
      if (this.isOfType(handler, 'Array')) {
        return this.recursivelyTypeCheckHandlers(handler as HandlerAction<MixinInterface>[]);
      }

      throw new Error(`${handler} is not a function or an array of functions.`);
    });
  }

  handle(path: string | RegExp): void;
  handle(path: string | RegExp, ...handlerList: HandlerAction<MixinInterface>[]): void;
  handle(...handlerList: HandlerAction<MixinInterface>[]): void;
  handle(
    path: string | RegExp | HandlerAction<MixinInterface>,
    ...handlerList: HandlerAction<MixinInterface>[]
  ): void {
    // If path is neither string nor regex, assume it's a handler
    // And set path to regex matching all
    let registerablePath: string | RegExp;

    if (this.isOfType(path, 'String')) {
      registerablePath = path as string;
    } else if (this.isOfType(path, 'RegExp')) {
      registerablePath = path as RegExp;
    } else {
      handlerList.unshift(path as HandlerAction<MixinInterface>);
      registerablePath = /.*/;
    }

    this.recursivelyTypeCheckHandlers(handlerList);

    let params: Key[] = [];
    const regex = pathToRegexp(registerablePath, params, {
      sensitive: this.caseSensitive,
      strict: this.strict,
    });

    this.handlerList.push({
      regex,
      handlers: handlerList.map((handler) => {
        return {
          action: handler,
          params,
        };
      }),
    });
  }

  private buildParams(execResult: RegExpExecArray, paramsList: Key[] = []): ObjectWithDynamicKeys {
    let params: ObjectWithDynamicKeys = {};

    paramsList.forEach((paramConfig, i) => {
      params[paramConfig.name] = execResult[i + 1];
    });

    return params;
  }

  private async resolveWithHandler(
    execResult: RegExpExecArray,
    handler: Handler<MixinInterface>,
    context: Context<MixinInterface>,
    { params }: { params?: ObjectWithDynamicKeys } = {},
  ): Promise<void> {
    context.params = params || this.buildParams(execResult, handler.params);

    if (
      this.isOfType(handler.action, 'Function') ||
      this.isOfType(handler.action, 'AsyncFunction')
    ) {
      await Promise.resolve((handler.action as HandlerFunction<MixinInterface>)(context));
    } else if (this.isOfType(handler.action, 'Array')) {
      await Promise.all(
        (handler.action as HandlerFunction<MixinInterface>[]).map((action) => {
          return this.resolveWithHandler(execResult, { action, params: [] }, context, {
            params: context.params,
          });
        }),
      );
    } else {
      throw new Error('Path handler should be a function or an array of functions.');
    }
  }

  async resolve(path: string, data: { [key: string]: any } = {}): Promise<Context<MixinInterface>> {
    if (!this.isOfType(path, 'String')) {
      throw 'Path to be resolved must be a string';
    }

    let [route] = path.split('?');
    [route] = route.split('#');

    let context: Context<MixinInterface> = Object.assign(Object.create(this.mixins || {}), {
      route: path,
      router: this,
      data,
    });

    try {
      for (let handlerConfig of this.handlerList) {
        const execResult = handlerConfig.regex.exec(route);
        if (execResult) {
          for (let handler of handlerConfig.handlers) {
            await this.resolveWithHandler(execResult, handler, context);
          }
        }
      }
    } catch (err) {
      if (err !== 'route') {
        throw err;
      }
    }

    return context;
  }
}
