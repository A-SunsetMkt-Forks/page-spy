import type {
  SpyConsole,
  PageSpyPlugin,
  OnInitParams,
  SpyBase,
} from '@huolala-tech/page-spy-types';
import { getRandomId } from '@huolala-tech/page-spy-base/dist/utils';
import { atom } from '@huolala-tech/page-spy-base/dist/atom';
import { makeMessage } from '@huolala-tech/page-spy-base/dist/message';
import socketStore from '../helpers/socket';
import type { InitConfig } from '../config';

export default class ConsolePlugin implements PageSpyPlugin {
  public name: string = 'ConsolePlugin';

  public console: Record<string, any> = {};

  public static hasInitd = false;

  public proxyTypes: SpyConsole.ProxyType[] = [
    'log',
    'info',
    'error',
    'warn',
    'debug',
  ];

  public $pageSpyConfig: InitConfig | null = null;

  public async onInit({ config }: OnInitParams<InitConfig>) {
    if (ConsolePlugin.hasInitd) return;
    ConsolePlugin.hasInitd = true;

    socketStore.addListener('debug', ConsolePlugin.handleDebugger);

    this.$pageSpyConfig = config;
    this.init();
  }

  public init() {
    const that = this;
    this.proxyTypes.forEach((item) => {
      // Not using globalThis or global, cause "console" exists in any env,
      // but global may be blocked.
      this.console[item] = console[item] || console.log || (() => {});
      Object.defineProperty(console, item, {
        value(...args: any[]) {
          that.printLog({
            logType: item,
            logs: args,
            url: '',
          });
        },
        configurable: true,
        enumerable: true,
        writable: true,
      });
    });
  }

  public reset() {
    this.proxyTypes.forEach((item) => {
      console[item] = this.console[item];
    });
  }

  public onReset() {
    this.reset();
    ConsolePlugin.hasInitd = false;
  }

  // run executable code which received from remote and send back the result
  public static handleDebugger(
    { source }: SpyBase.InteractiveEvent<string>,
    reply: (data: any) => void,
  ) {
    const { type, data } = source;
    if (type === 'debug') {
      const originMsg = makeMessage('console', {
        logType: 'debug-origin',
        logs: [
          {
            id: getRandomId(),
            type: 'debug-origin',
            value: data,
          },
        ],
      });
      reply(originMsg);
      try {
        // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
        const result = new Function(`return ${data}`)();
        const evalMsg = makeMessage('console', {
          logType: 'debug-eval',
          logs: [atom.transformToAtom(result)],
        });
        reply(evalMsg);
      } catch (err) {
        const errMsg = makeMessage('console', {
          logType: 'error',
          logs: [
            {
              type: 'error',
              value: (err as Error).stack,
            },
          ],
        });
        reply(errMsg);
      }
    }
  }

  public printLog(data: SpyConsole.DataItem) {
    if (data.logs && data.logs.length) {
      const processor = this.$pageSpyConfig?.dataProcessor?.console;
      if (processor) {
        this.reset();
        const processedByUser = processor(data);
        this.init();

        if (processedByUser === false) return;
      }

      this.console[data.logType](...data.logs);
      const atomLog = makeMessage('console', {
        ...data,
        time: Date.now(),
        logs: data.logs.map((log) => {
          return atom.transformToAtom(log, false);
        }),
      });
      socketStore.broadcastMessage(atomLog);

      if (!this.$pageSpyConfig?.serializeData) {
        socketStore.dispatchEvent('public-data', atomLog);
      } else {
        const serializeLog = {
          ...atomLog,
          data: {
            ...atomLog.data,
            logs: data.logs.map((log) => {
              return atom.transformToAtom(log, true);
            }),
          },
        };
        socketStore.dispatchEvent('public-data', serializeLog);
      }
    }
  }
}
