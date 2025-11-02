var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../../../../.bun/install/global/node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
__name(notImplementedClass, "notImplementedClass");

// ../../../../.bun/install/global/node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// ../../../../.bun/install/global/node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// ../../../../.bun/install/global/node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";

// ../../../../.bun/install/global/node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default = Object.assign(() => {
}, { __unenv__: true });

// ../../../../.bun/install/global/node_modules/unenv/dist/runtime/node/console.mjs
var _console = globalThis.console;
var _ignoreErrors = true;
var _stderr = new Writable();
var _stdout = new Writable();
var log = _console?.log ?? noop_default;
var info = _console?.info ?? log;
var trace = _console?.trace ?? info;
var debug = _console?.debug ?? log;
var table = _console?.table ?? log;
var error = _console?.error ?? log;
var warn = _console?.warn ?? error;
var createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
var clear = _console?.clear ?? noop_default;
var count = _console?.count ?? noop_default;
var countReset = _console?.countReset ?? noop_default;
var dir = _console?.dir ?? noop_default;
var dirxml = _console?.dirxml ?? noop_default;
var group = _console?.group ?? noop_default;
var groupEnd = _console?.groupEnd ?? noop_default;
var groupCollapsed = _console?.groupCollapsed ?? noop_default;
var profile = _console?.profile ?? noop_default;
var profileEnd = _console?.profileEnd ?? noop_default;
var time = _console?.time ?? noop_default;
var timeEnd = _console?.timeEnd ?? noop_default;
var timeLog = _console?.timeLog ?? noop_default;
var timeStamp = _console?.timeStamp ?? noop_default;
var Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
var _times = /* @__PURE__ */ new Map();
var _stdoutErrorHandler = noop_default;
var _stderrErrorHandler = noop_default;

// ../../../../.bun/install/global/node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole = globalThis["console"];
var {
  assert,
  clear: clear2,
  // @ts-expect-error undocumented public API
  context,
  count: count2,
  countReset: countReset2,
  // @ts-expect-error undocumented public API
  createTask: createTask2,
  debug: debug2,
  dir: dir2,
  dirxml: dirxml2,
  error: error2,
  group: group2,
  groupCollapsed: groupCollapsed2,
  groupEnd: groupEnd2,
  info: info2,
  log: log2,
  profile: profile2,
  profileEnd: profileEnd2,
  table: table2,
  time: time2,
  timeEnd: timeEnd2,
  timeLog: timeLog2,
  timeStamp: timeStamp2,
  trace: trace2,
  warn: warn2
} = workerdConsole;
Object.assign(workerdConsole, {
  Console,
  _ignoreErrors,
  _stderr,
  _stderrErrorHandler,
  _stdout,
  _stdoutErrorHandler,
  _times
});
var console_default = workerdConsole;

// ../../../../.bun/install/global/node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
globalThis.console = console_default;

// ../../../../.bun/install/global/node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// ../../../../.bun/install/global/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// ../../../../.bun/install/global/node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// ../../../../.bun/install/global/node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir3, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x2, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count3, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// ../../../../.bun/install/global/node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// ../../../../.bun/install/global/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// ../../../../.bun/install/global/node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var isWorkerdProcessV2 = globalThis.Cloudflare.compatibilityFlags.enable_nodejs_process_v2;
var unenvProcess = new Process({
  env: globalProcess.env,
  // `hrtime` is only available from workerd process v2
  hrtime: isWorkerdProcessV2 ? workerdProcess.hrtime : hrtime,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess.nextTick
});
var { exit, features, platform } = workerdProcess;
var {
  // Always implemented by workerd
  env,
  // Only implemented in workerd v2
  hrtime: hrtime3,
  // Always implemented by workerd
  nextTick
} = unenvProcess;
var {
  _channel,
  _disconnect,
  _events,
  _eventsCount,
  _handleQueue,
  _maxListeners,
  _pendingMessage,
  _send,
  assert: assert2,
  disconnect,
  mainModule
} = unenvProcess;
var {
  // @ts-expect-error `_debugEnd` is missing typings
  _debugEnd,
  // @ts-expect-error `_debugProcess` is missing typings
  _debugProcess,
  // @ts-expect-error `_exiting` is missing typings
  _exiting,
  // @ts-expect-error `_fatalException` is missing typings
  _fatalException,
  // @ts-expect-error `_getActiveHandles` is missing typings
  _getActiveHandles,
  // @ts-expect-error `_getActiveRequests` is missing typings
  _getActiveRequests,
  // @ts-expect-error `_kill` is missing typings
  _kill,
  // @ts-expect-error `_linkedBinding` is missing typings
  _linkedBinding,
  // @ts-expect-error `_preload_modules` is missing typings
  _preload_modules,
  // @ts-expect-error `_rawDebug` is missing typings
  _rawDebug,
  // @ts-expect-error `_startProfilerIdleNotifier` is missing typings
  _startProfilerIdleNotifier,
  // @ts-expect-error `_stopProfilerIdleNotifier` is missing typings
  _stopProfilerIdleNotifier,
  // @ts-expect-error `_tickCallback` is missing typings
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  availableMemory,
  // @ts-expect-error `binding` is missing typings
  binding,
  channel,
  chdir,
  config,
  connected,
  constrainedMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  // @ts-expect-error `domain` is missing typings
  domain,
  emit,
  emitWarning,
  eventNames,
  execArgv,
  execPath,
  exitCode,
  finalization,
  getActiveResourcesInfo,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getMaxListeners,
  getuid,
  hasUncaughtExceptionCaptureCallback,
  // @ts-expect-error `initgroups` is missing typings
  initgroups,
  kill,
  listenerCount,
  listeners,
  loadEnvFile,
  memoryUsage,
  // @ts-expect-error `moduleLoadList` is missing typings
  moduleLoadList,
  off,
  on,
  once,
  // @ts-expect-error `openStdin` is missing typings
  openStdin,
  permission,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  // @ts-expect-error `reallyExit` is missing typings
  reallyExit,
  ref,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  send,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setMaxListeners,
  setSourceMapsEnabled,
  setuid,
  setUncaughtExceptionCaptureCallback,
  sourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  throwDeprecation,
  title,
  traceDeprecation,
  umask,
  unref,
  uptime,
  version,
  versions
} = isWorkerdProcessV2 ? workerdProcess : unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// ../../../../.bun/install/global/node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// dist/app.js
if (typeof globalThis.self === "undefined") {
  globalThis.self = globalThis;
}
var fetchHandlers = [];
var originalAddEventListener = globalThis.addEventListener;
globalThis.addEventListener = function(type, handler, options) {
  if (type === "fetch") {
    fetchHandlers.push(handler);
  } else {
    originalAddEventListener?.call(this, type, handler, options);
  }
};
var __defProp2 = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = /* @__PURE__ */ __name((fn, res) => /* @__PURE__ */ __name(function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
}, "__init"), "__esm");
var __export = /* @__PURE__ */ __name((target, all) => {
  for (var name in all)
    __defProp2(target, name, { get: all[name], enumerable: true });
}, "__export");
function Oe(e, t) {
  return (t ? /^[\x00-\xFF]*$/ : /^[\x00-\x7F]*$/).test(e);
}
__name(Oe, "Oe");
function D(e, t = false) {
  let r = [], n = 0;
  for (; n < e.length; ) {
    let c = e[n], l = a(function(f) {
      if (!t)
        throw new TypeError(f);
      r.push({ type: "INVALID_CHAR", index: n, value: e[n++] });
    }, "ErrorOrInvalid");
    if (c === "*") {
      r.push({ type: "ASTERISK", index: n, value: e[n++] });
      continue;
    }
    if (c === "+" || c === "?") {
      r.push({ type: "OTHER_MODIFIER", index: n, value: e[n++] });
      continue;
    }
    if (c === "\\") {
      r.push({ type: "ESCAPED_CHAR", index: n++, value: e[n++] });
      continue;
    }
    if (c === "{") {
      r.push({ type: "OPEN", index: n, value: e[n++] });
      continue;
    }
    if (c === "}") {
      r.push({ type: "CLOSE", index: n, value: e[n++] });
      continue;
    }
    if (c === ":") {
      let f = "", s = n + 1;
      for (; s < e.length; ) {
        let i = e.substr(s, 1);
        if (s === n + 1 && Re.test(i) || s !== n + 1 && Ee.test(i)) {
          f += e[s++];
          continue;
        }
        break;
      }
      if (!f) {
        l(`Missing parameter name at ${n}`);
        continue;
      }
      r.push({ type: "NAME", index: n, value: f }), n = s;
      continue;
    }
    if (c === "(") {
      let f = 1, s = "", i = n + 1, o = false;
      if (e[i] === "?") {
        l(`Pattern cannot start with "?" at ${i}`);
        continue;
      }
      for (; i < e.length; ) {
        if (!Oe(e[i], false)) {
          l(`Invalid character '${e[i]}' at ${i}.`), o = true;
          break;
        }
        if (e[i] === "\\") {
          s += e[i++] + e[i++];
          continue;
        }
        if (e[i] === ")") {
          if (f--, f === 0) {
            i++;
            break;
          }
        } else if (e[i] === "(" && (f++, e[i + 1] !== "?")) {
          l(`Capturing groups are not allowed at ${i}`), o = true;
          break;
        }
        s += e[i++];
      }
      if (o)
        continue;
      if (f) {
        l(`Unbalanced pattern at ${n}`);
        continue;
      }
      if (!s) {
        l(`Missing pattern at ${n}`);
        continue;
      }
      r.push({ type: "REGEX", index: n, value: s }), n = i;
      continue;
    }
    r.push({ type: "CHAR", index: n, value: e[n++] });
  }
  return r.push({ type: "END", index: n, value: "" }), r;
}
__name(D, "D");
function F(e, t = {}) {
  let r = D(e);
  t.delimiter ??= "/#?", t.prefixes ??= "./";
  let n = `[^${x(t.delimiter)}]+?`, c = [], l = 0, f = 0, s = "", i = /* @__PURE__ */ new Set(), o = a((u) => {
    if (f < r.length && r[f].type === u)
      return r[f++].value;
  }, "tryConsume"), h = a(() => o("OTHER_MODIFIER") ?? o("ASTERISK"), "tryConsumeModifier"), p = a((u) => {
    let d = o(u);
    if (d !== void 0)
      return d;
    let { type: g, index: y } = r[f];
    throw new TypeError(`Unexpected ${g} at ${y}, expected ${u}`);
  }, "mustConsume"), A = a(() => {
    let u = "", d;
    for (; d = o("CHAR") ?? o("ESCAPED_CHAR"); )
      u += d;
    return u;
  }, "consumeText"), xe = a((u) => u, "DefaultEncodePart"), N = t.encodePart || xe, H = "", $ = a((u) => {
    H += u;
  }, "appendToPendingFixedValue"), M = a(() => {
    H.length && (c.push(new P(3, "", "", N(H), "", 3)), H = "");
  }, "maybeAddPartFromPendingFixedValue"), X = a((u, d, g, y, Z) => {
    let m = 3;
    switch (Z) {
      case "?":
        m = 1;
        break;
      case "*":
        m = 0;
        break;
      case "+":
        m = 2;
        break;
    }
    if (!d && !g && m === 3) {
      $(u);
      return;
    }
    if (M(), !d && !g) {
      if (!u)
        return;
      c.push(new P(3, "", "", N(u), "", m));
      return;
    }
    let S;
    g ? g === "*" ? S = v : S = g : S = n;
    let k = 2;
    S === n ? (k = 1, S = "") : S === v && (k = 0, S = "");
    let E;
    if (d ? E = d : g && (E = l++), i.has(E))
      throw new TypeError(`Duplicate name '${E}'.`);
    i.add(E), c.push(new P(k, E, N(u), S, N(y), m));
  }, "addPart");
  for (; f < r.length; ) {
    let u = o("CHAR"), d = o("NAME"), g = o("REGEX");
    if (!d && !g && (g = o("ASTERISK")), d || g) {
      let m = u ?? "";
      t.prefixes.indexOf(m) === -1 && ($(m), m = ""), M();
      let S = h();
      X(m, d, g, "", S);
      continue;
    }
    let y = u ?? o("ESCAPED_CHAR");
    if (y) {
      $(y);
      continue;
    }
    if (o("OPEN")) {
      let m = A(), S = o("NAME"), k = o("REGEX");
      !S && !k && (k = o("ASTERISK"));
      let E = A();
      p("CLOSE");
      let be = h();
      X(m, S, k, E, be);
      continue;
    }
    M(), p("END");
  }
  return c;
}
__name(F, "F");
function x(e) {
  return e.replace(/([.+*?^${}()[\]|/\\])/g, "\\$1");
}
__name(x, "x");
function B(e) {
  return e && e.ignoreCase ? "ui" : "u";
}
__name(B, "B");
function q(e, t, r) {
  return W(F(e, r), t, r);
}
__name(q, "q");
function T(e) {
  switch (e) {
    case 0:
      return "*";
    case 1:
      return "?";
    case 2:
      return "+";
    case 3:
      return "";
  }
}
__name(T, "T");
function W(e, t, r = {}) {
  r.delimiter ??= "/#?", r.prefixes ??= "./", r.sensitive ??= false, r.strict ??= false, r.end ??= true, r.start ??= true, r.endsWith = "";
  let n = r.start ? "^" : "";
  for (let s of e) {
    if (s.type === 3) {
      s.modifier === 3 ? n += x(s.value) : n += `(?:${x(s.value)})${T(s.modifier)}`;
      continue;
    }
    t && t.push(s.name);
    let i = `[^${x(r.delimiter)}]+?`, o = s.value;
    if (s.type === 1 ? o = i : s.type === 0 && (o = v), !s.prefix.length && !s.suffix.length) {
      s.modifier === 3 || s.modifier === 1 ? n += `(${o})${T(s.modifier)}` : n += `((?:${o})${T(s.modifier)})`;
      continue;
    }
    if (s.modifier === 3 || s.modifier === 1) {
      n += `(?:${x(s.prefix)}(${o})${x(s.suffix)})`, n += T(s.modifier);
      continue;
    }
    n += `(?:${x(s.prefix)}`, n += `((?:${o})(?:`, n += x(s.suffix), n += x(s.prefix), n += `(?:${o}))*)${x(s.suffix)})`, s.modifier === 0 && (n += "?");
  }
  let c = `[${x(r.endsWith)}]|$`, l = `[${x(r.delimiter)}]`;
  if (r.end)
    return r.strict || (n += `${l}?`), r.endsWith.length ? n += `(?=${c})` : n += "$", new RegExp(n, B(r));
  r.strict || (n += `(?:${l}(?=${c}))?`);
  let f = false;
  if (e.length) {
    let s = e[e.length - 1];
    s.type === 3 && s.modifier === 3 && (f = r.delimiter.indexOf(s) > -1);
  }
  return f || (n += `(?=${l}|${c})`), new RegExp(n, B(r));
}
__name(W, "W");
function ee(e, t) {
  return e.length ? e[0] === "/" ? true : !t || e.length < 2 ? false : (e[0] == "\\" || e[0] == "{") && e[1] == "/" : false;
}
__name(ee, "ee");
function te(e, t) {
  return e.startsWith(t) ? e.substring(t.length, e.length) : e;
}
__name(te, "te");
function ke(e, t) {
  return e.endsWith(t) ? e.substr(0, e.length - t.length) : e;
}
__name(ke, "ke");
function _(e) {
  return !e || e.length < 2 ? false : e[0] === "[" || (e[0] === "\\" || e[0] === "{") && e[1] === "[";
}
__name(_, "_");
function U(e) {
  if (!e)
    return true;
  for (let t of re)
    if (e.test(t))
      return true;
  return false;
}
__name(U, "U");
function ne(e, t) {
  if (e = te(e, "#"), t || e === "")
    return e;
  let r = new URL("https://example.com");
  return r.hash = e, r.hash ? r.hash.substring(1, r.hash.length) : "";
}
__name(ne, "ne");
function se(e, t) {
  if (e = te(e, "?"), t || e === "")
    return e;
  let r = new URL("https://example.com");
  return r.search = e, r.search ? r.search.substring(1, r.search.length) : "";
}
__name(se, "se");
function ie(e, t) {
  return t || e === "" ? e : _(e) ? K(e) : j(e);
}
__name(ie, "ie");
function ae(e, t) {
  if (t || e === "")
    return e;
  let r = new URL("https://example.com");
  return r.password = e, r.password;
}
__name(ae, "ae");
function oe(e, t) {
  if (t || e === "")
    return e;
  let r = new URL("https://example.com");
  return r.username = e, r.username;
}
__name(oe, "oe");
function ce(e, t, r) {
  if (r || e === "")
    return e;
  if (t && !re.includes(t))
    return new URL(`${t}:${e}`).pathname;
  let n = e[0] == "/";
  return e = new URL(n ? e : "/-" + e, "https://example.com").pathname, n || (e = e.substring(2, e.length)), e;
}
__name(ce, "ce");
function le(e, t, r) {
  return z(t) === e && (e = ""), r || e === "" ? e : G(e);
}
__name(le, "le");
function fe(e, t) {
  return e = ke(e, ":"), t || e === "" ? e : w(e);
}
__name(fe, "fe");
function z(e) {
  switch (e) {
    case "ws":
    case "http":
      return "80";
    case "wws":
    case "https":
      return "443";
    case "ftp":
      return "21";
    default:
      return "";
  }
}
__name(z, "z");
function w(e) {
  if (e === "")
    return e;
  if (/^[-+.A-Za-z0-9]*$/.test(e))
    return e.toLowerCase();
  throw new TypeError(`Invalid protocol '${e}'.`);
}
__name(w, "w");
function he(e) {
  if (e === "")
    return e;
  let t = new URL("https://example.com");
  return t.username = e, t.username;
}
__name(he, "he");
function ue(e) {
  if (e === "")
    return e;
  let t = new URL("https://example.com");
  return t.password = e, t.password;
}
__name(ue, "ue");
function j(e) {
  if (e === "")
    return e;
  if (/[\t\n\r #%/:<>?@[\]^\\|]/g.test(e))
    throw new TypeError(`Invalid hostname '${e}'`);
  let t = new URL("https://example.com");
  return t.hostname = e, t.hostname;
}
__name(j, "j");
function K(e) {
  if (e === "")
    return e;
  if (/[^0-9a-fA-F[\]:]/g.test(e))
    throw new TypeError(`Invalid IPv6 hostname '${e}'`);
  return e.toLowerCase();
}
__name(K, "K");
function G(e) {
  if (e === "" || /^[0-9]*$/.test(e) && parseInt(e) <= 65535)
    return e;
  throw new TypeError(`Invalid port '${e}'.`);
}
__name(G, "G");
function de(e) {
  if (e === "")
    return e;
  let t = new URL("https://example.com");
  return t.pathname = e[0] !== "/" ? "/-" + e : e, e[0] !== "/" ? t.pathname.substring(2, t.pathname.length) : t.pathname;
}
__name(de, "de");
function pe(e) {
  return e === "" ? e : new URL(`data:${e}`).pathname;
}
__name(pe, "pe");
function ge(e) {
  if (e === "")
    return e;
  let t = new URL("https://example.com");
  return t.search = e, t.search.substring(1, t.search.length);
}
__name(ge, "ge");
function me(e) {
  if (e === "")
    return e;
  let t = new URL("https://example.com");
  return t.hash = e, t.hash.substring(1, t.hash.length);
}
__name(me, "me");
function Se(e, t) {
  if (typeof e != "string")
    throw new TypeError("parameter 1 is not of type 'string'.");
  let r = new URL(e, t);
  return { protocol: r.protocol.substring(0, r.protocol.length - 1), username: r.username, password: r.password, hostname: r.hostname, port: r.port, pathname: r.pathname, search: r.search !== "" ? r.search.substring(1, r.search.length) : void 0, hash: r.hash !== "" ? r.hash.substring(1, r.hash.length) : void 0 };
}
__name(Se, "Se");
function R(e, t) {
  return t ? I(e) : e;
}
__name(R, "R");
function L(e, t, r) {
  let n;
  if (typeof t.baseURL == "string")
    try {
      n = new URL(t.baseURL), t.protocol === void 0 && (e.protocol = R(n.protocol.substring(0, n.protocol.length - 1), r)), !r && t.protocol === void 0 && t.hostname === void 0 && t.port === void 0 && t.username === void 0 && (e.username = R(n.username, r)), !r && t.protocol === void 0 && t.hostname === void 0 && t.port === void 0 && t.username === void 0 && t.password === void 0 && (e.password = R(n.password, r)), t.protocol === void 0 && t.hostname === void 0 && (e.hostname = R(n.hostname, r)), t.protocol === void 0 && t.hostname === void 0 && t.port === void 0 && (e.port = R(n.port, r)), t.protocol === void 0 && t.hostname === void 0 && t.port === void 0 && t.pathname === void 0 && (e.pathname = R(n.pathname, r)), t.protocol === void 0 && t.hostname === void 0 && t.port === void 0 && t.pathname === void 0 && t.search === void 0 && (e.search = R(n.search.substring(1, n.search.length), r)), t.protocol === void 0 && t.hostname === void 0 && t.port === void 0 && t.pathname === void 0 && t.search === void 0 && t.hash === void 0 && (e.hash = R(n.hash.substring(1, n.hash.length), r));
    } catch {
      throw new TypeError(`invalid baseURL '${t.baseURL}'.`);
    }
  if (typeof t.protocol == "string" && (e.protocol = fe(t.protocol, r)), typeof t.username == "string" && (e.username = oe(t.username, r)), typeof t.password == "string" && (e.password = ae(t.password, r)), typeof t.hostname == "string" && (e.hostname = ie(t.hostname, r)), typeof t.port == "string" && (e.port = le(t.port, e.protocol, r)), typeof t.pathname == "string") {
    if (e.pathname = t.pathname, n && !ee(e.pathname, r)) {
      let c = n.pathname.lastIndexOf("/");
      c >= 0 && (e.pathname = R(n.pathname.substring(0, c + 1), r) + e.pathname);
    }
    e.pathname = ce(e.pathname, e.protocol, r);
  }
  return typeof t.search == "string" && (e.search = se(t.search, r)), typeof t.hash == "string" && (e.hash = ne(t.hash, r)), e;
}
__name(L, "L");
function I(e) {
  return e.replace(/([+*?:{}()\\])/g, "\\$1");
}
__name(I, "I");
function Te(e) {
  return e.replace(/([.+*?^${}()[\]|/\\])/g, "\\$1");
}
__name(Te, "Te");
function Ae(e, t) {
  t.delimiter ??= "/#?", t.prefixes ??= "./", t.sensitive ??= false, t.strict ??= false, t.end ??= true, t.start ??= true, t.endsWith = "";
  let r = ".*", n = `[^${Te(t.delimiter)}]+?`, c = /[$_\u200C\u200D\p{ID_Continue}]/u, l = "";
  for (let f = 0; f < e.length; ++f) {
    let s = e[f];
    if (s.type === 3) {
      if (s.modifier === 3) {
        l += I(s.value);
        continue;
      }
      l += `{${I(s.value)}}${T(s.modifier)}`;
      continue;
    }
    let i = s.hasCustomName(), o = !!s.suffix.length || !!s.prefix.length && (s.prefix.length !== 1 || !t.prefixes.includes(s.prefix)), h = f > 0 ? e[f - 1] : null, p = f < e.length - 1 ? e[f + 1] : null;
    if (!o && i && s.type === 1 && s.modifier === 3 && p && !p.prefix.length && !p.suffix.length)
      if (p.type === 3) {
        let A = p.value.length > 0 ? p.value[0] : "";
        o = c.test(A);
      } else
        o = !p.hasCustomName();
    if (!o && !s.prefix.length && h && h.type === 3) {
      let A = h.value[h.value.length - 1];
      o = t.prefixes.includes(A);
    }
    o && (l += "{"), l += I(s.prefix), i && (l += `:${s.name}`), s.type === 2 ? l += `(${s.value})` : s.type === 1 ? i || (l += `(${n})`) : s.type === 0 && (!i && (!h || h.type === 3 || h.modifier !== 3 || o || s.prefix !== "") ? l += "*" : l += `(${r})`), s.type === 1 && i && s.suffix.length && c.test(s.suffix[0]) && (l += "\\"), l += I(s.suffix), o && (l += "}"), s.modifier !== 3 && (l += T(s.modifier));
  }
  return l;
}
__name(Ae, "Ae");
var Pe;
var a;
var P;
var Re;
var Ee;
var v;
var b;
var J;
var Q;
var re;
var C;
var V;
var O;
var Y;
var init_urlpattern = __esm({
  "packages/match-pattern/node_modules/urlpattern-polyfill/dist/urlpattern.js"() {
    Pe = Object.defineProperty;
    a = /* @__PURE__ */ __name((e, t) => Pe(e, "name", { value: t, configurable: true }), "a");
    P = class {
      static {
        __name(this, "P");
      }
      type = 3;
      name = "";
      prefix = "";
      value = "";
      suffix = "";
      modifier = 3;
      constructor(t, r, n, c, l, f) {
        this.type = t, this.name = r, this.prefix = n, this.value = c, this.suffix = l, this.modifier = f;
      }
      hasCustomName() {
        return this.name !== "" && typeof this.name != "number";
      }
    };
    a(P, "Part");
    Re = /[$_\p{ID_Start}]/u;
    Ee = /[$_\u200C\u200D\p{ID_Continue}]/u;
    v = ".*";
    a(Oe, "isASCII");
    a(D, "lexer");
    a(F, "parse");
    a(x, "escapeString");
    a(B, "flags");
    a(q, "stringToRegexp");
    a(T, "modifierToString");
    a(W, "partsToRegexp");
    b = { delimiter: "", prefixes: "", sensitive: true, strict: true };
    J = { delimiter: ".", prefixes: "", sensitive: true, strict: true };
    Q = { delimiter: "/", prefixes: "/", sensitive: true, strict: true };
    a(ee, "isAbsolutePathname");
    a(te, "maybeStripPrefix");
    a(ke, "maybeStripSuffix");
    a(_, "treatAsIPv6Hostname");
    re = ["ftp", "file", "http", "https", "ws", "wss"];
    a(U, "isSpecialScheme");
    a(ne, "canonicalizeHash");
    a(se, "canonicalizeSearch");
    a(ie, "canonicalizeHostname");
    a(ae, "canonicalizePassword");
    a(oe, "canonicalizeUsername");
    a(ce, "canonicalizePathname");
    a(le, "canonicalizePort");
    a(fe, "canonicalizeProtocol");
    a(z, "defaultPortForProtocol");
    a(w, "protocolEncodeCallback");
    a(he, "usernameEncodeCallback");
    a(ue, "passwordEncodeCallback");
    a(j, "hostnameEncodeCallback");
    a(K, "ipv6HostnameEncodeCallback");
    a(G, "portEncodeCallback");
    a(de, "standardURLPathnameEncodeCallback");
    a(pe, "pathURLPathnameEncodeCallback");
    a(ge, "searchEncodeCallback");
    a(me, "hashEncodeCallback");
    C = class {
      static {
        __name(this, "C");
      }
      #i;
      #n = [];
      #t = {};
      #e = 0;
      #s = 1;
      #l = 0;
      #o = 0;
      #d = 0;
      #p = 0;
      #g = false;
      constructor(t) {
        this.#i = t;
      }
      get result() {
        return this.#t;
      }
      parse() {
        for (this.#n = D(this.#i, true); this.#e < this.#n.length; this.#e += this.#s) {
          if (this.#s = 1, this.#n[this.#e].type === "END") {
            if (this.#o === 0) {
              this.#b(), this.#f() ? this.#r(9, 1) : this.#h() ? this.#r(8, 1) : this.#r(7, 0);
              continue;
            } else if (this.#o === 2) {
              this.#u(5);
              continue;
            }
            this.#r(10, 0);
            break;
          }
          if (this.#d > 0)
            if (this.#A())
              this.#d -= 1;
            else
              continue;
          if (this.#T()) {
            this.#d += 1;
            continue;
          }
          switch (this.#o) {
            case 0:
              this.#P() && this.#u(1);
              break;
            case 1:
              if (this.#P()) {
                this.#C();
                let t = 7, r = 1;
                this.#E() ? (t = 2, r = 3) : this.#g && (t = 2), this.#r(t, r);
              }
              break;
            case 2:
              this.#S() ? this.#u(3) : (this.#x() || this.#h() || this.#f()) && this.#u(5);
              break;
            case 3:
              this.#O() ? this.#r(4, 1) : this.#S() && this.#r(5, 1);
              break;
            case 4:
              this.#S() && this.#r(5, 1);
              break;
            case 5:
              this.#y() ? this.#p += 1 : this.#w() && (this.#p -= 1), this.#k() && !this.#p ? this.#r(6, 1) : this.#x() ? this.#r(7, 0) : this.#h() ? this.#r(8, 1) : this.#f() && this.#r(9, 1);
              break;
            case 6:
              this.#x() ? this.#r(7, 0) : this.#h() ? this.#r(8, 1) : this.#f() && this.#r(9, 1);
              break;
            case 7:
              this.#h() ? this.#r(8, 1) : this.#f() && this.#r(9, 1);
              break;
            case 8:
              this.#f() && this.#r(9, 1);
              break;
            case 9:
              break;
            case 10:
              break;
          }
        }
        this.#t.hostname !== void 0 && this.#t.port === void 0 && (this.#t.port = "");
      }
      #r(t, r) {
        switch (this.#o) {
          case 0:
            break;
          case 1:
            this.#t.protocol = this.#c();
            break;
          case 2:
            break;
          case 3:
            this.#t.username = this.#c();
            break;
          case 4:
            this.#t.password = this.#c();
            break;
          case 5:
            this.#t.hostname = this.#c();
            break;
          case 6:
            this.#t.port = this.#c();
            break;
          case 7:
            this.#t.pathname = this.#c();
            break;
          case 8:
            this.#t.search = this.#c();
            break;
          case 9:
            this.#t.hash = this.#c();
            break;
          case 10:
            break;
        }
        this.#o !== 0 && t !== 10 && ([1, 2, 3, 4].includes(this.#o) && [6, 7, 8, 9].includes(t) && (this.#t.hostname ??= ""), [1, 2, 3, 4, 5, 6].includes(this.#o) && [8, 9].includes(t) && (this.#t.pathname ??= this.#g ? "/" : ""), [1, 2, 3, 4, 5, 6, 7].includes(this.#o) && t === 9 && (this.#t.search ??= "")), this.#R(t, r);
      }
      #R(t, r) {
        this.#o = t, this.#l = this.#e + r, this.#e += r, this.#s = 0;
      }
      #b() {
        this.#e = this.#l, this.#s = 0;
      }
      #u(t) {
        this.#b(), this.#o = t;
      }
      #m(t) {
        return t < 0 && (t = this.#n.length - t), t < this.#n.length ? this.#n[t] : this.#n[this.#n.length - 1];
      }
      #a(t, r) {
        let n = this.#m(t);
        return n.value === r && (n.type === "CHAR" || n.type === "ESCAPED_CHAR" || n.type === "INVALID_CHAR");
      }
      #P() {
        return this.#a(this.#e, ":");
      }
      #E() {
        return this.#a(this.#e + 1, "/") && this.#a(this.#e + 2, "/");
      }
      #S() {
        return this.#a(this.#e, "@");
      }
      #O() {
        return this.#a(this.#e, ":");
      }
      #k() {
        return this.#a(this.#e, ":");
      }
      #x() {
        return this.#a(this.#e, "/");
      }
      #h() {
        if (this.#a(this.#e, "?"))
          return true;
        if (this.#n[this.#e].value !== "?")
          return false;
        let t = this.#m(this.#e - 1);
        return t.type !== "NAME" && t.type !== "REGEX" && t.type !== "CLOSE" && t.type !== "ASTERISK";
      }
      #f() {
        return this.#a(this.#e, "#");
      }
      #T() {
        return this.#n[this.#e].type == "OPEN";
      }
      #A() {
        return this.#n[this.#e].type == "CLOSE";
      }
      #y() {
        return this.#a(this.#e, "[");
      }
      #w() {
        return this.#a(this.#e, "]");
      }
      #c() {
        let t = this.#n[this.#e], r = this.#m(this.#l).index;
        return this.#i.substring(r, t.index);
      }
      #C() {
        let t = {};
        Object.assign(t, b), t.encodePart = w;
        let r = q(this.#c(), void 0, t);
        this.#g = U(r);
      }
    };
    a(C, "Parser");
    V = ["protocol", "username", "password", "hostname", "port", "pathname", "search", "hash"];
    O = "*";
    a(Se, "extractValues");
    a(R, "processBaseURLString");
    a(L, "applyInit");
    a(I, "escapePatternString");
    a(Te, "escapeRegexpString");
    a(Ae, "partsToPattern");
    Y = class {
      static {
        __name(this, "Y");
      }
      #i;
      #n = {};
      #t = {};
      #e = {};
      #s = {};
      #l = false;
      constructor(t = {}, r, n) {
        try {
          let c;
          if (typeof r == "string" ? c = r : n = r, typeof t == "string") {
            let i = new C(t);
            if (i.parse(), t = i.result, c === void 0 && typeof t.protocol != "string")
              throw new TypeError("A base URL must be provided for a relative constructor string.");
            t.baseURL = c;
          } else {
            if (!t || typeof t != "object")
              throw new TypeError("parameter 1 is not of type 'string' and cannot convert to dictionary.");
            if (c)
              throw new TypeError("parameter 1 is not of type 'string'.");
          }
          typeof n > "u" && (n = { ignoreCase: false });
          let l = { ignoreCase: n.ignoreCase === true }, f = { pathname: O, protocol: O, username: O, password: O, hostname: O, port: O, search: O, hash: O };
          this.#i = L(f, t, true), z(this.#i.protocol) === this.#i.port && (this.#i.port = "");
          let s;
          for (s of V) {
            if (!(s in this.#i))
              continue;
            let i = {}, o = this.#i[s];
            switch (this.#t[s] = [], s) {
              case "protocol":
                Object.assign(i, b), i.encodePart = w;
                break;
              case "username":
                Object.assign(i, b), i.encodePart = he;
                break;
              case "password":
                Object.assign(i, b), i.encodePart = ue;
                break;
              case "hostname":
                Object.assign(i, J), _(o) ? i.encodePart = K : i.encodePart = j;
                break;
              case "port":
                Object.assign(i, b), i.encodePart = G;
                break;
              case "pathname":
                U(this.#n.protocol) ? (Object.assign(i, Q, l), i.encodePart = de) : (Object.assign(i, b, l), i.encodePart = pe);
                break;
              case "search":
                Object.assign(i, b, l), i.encodePart = ge;
                break;
              case "hash":
                Object.assign(i, b, l), i.encodePart = me;
                break;
            }
            try {
              this.#s[s] = F(o, i), this.#n[s] = W(this.#s[s], this.#t[s], i), this.#e[s] = Ae(this.#s[s], i), this.#l = this.#l || this.#s[s].some((h) => h.type === 2);
            } catch {
              throw new TypeError(`invalid ${s} pattern '${this.#i[s]}'.`);
            }
          }
        } catch (c) {
          throw new TypeError(`Failed to construct 'URLPattern': ${c.message}`);
        }
      }
      get [Symbol.toStringTag]() {
        return "URLPattern";
      }
      test(t = {}, r) {
        let n = { pathname: "", protocol: "", username: "", password: "", hostname: "", port: "", search: "", hash: "" };
        if (typeof t != "string" && r)
          throw new TypeError("parameter 1 is not of type 'string'.");
        if (typeof t > "u")
          return false;
        try {
          typeof t == "object" ? n = L(n, t, false) : n = L(n, Se(t, r), false);
        } catch {
          return false;
        }
        let c;
        for (c of V)
          if (!this.#n[c].exec(n[c]))
            return false;
        return true;
      }
      exec(t = {}, r) {
        let n = { pathname: "", protocol: "", username: "", password: "", hostname: "", port: "", search: "", hash: "" };
        if (typeof t != "string" && r)
          throw new TypeError("parameter 1 is not of type 'string'.");
        if (typeof t > "u")
          return;
        try {
          typeof t == "object" ? n = L(n, t, false) : n = L(n, Se(t, r), false);
        } catch {
          return null;
        }
        let c = {};
        r ? c.inputs = [t, r] : c.inputs = [t];
        let l;
        for (l of V) {
          let f = this.#n[l].exec(n[l]);
          if (!f)
            return null;
          let s = {};
          for (let [i, o] of this.#t[l].entries())
            if (typeof o == "string" || typeof o == "number") {
              let h = f[i + 1];
              s[o] = h;
            }
          c[l] = { input: n[l] ?? "", groups: s };
        }
        return c;
      }
      static compareComponent(t, r, n) {
        let c = a((i, o) => {
          for (let h of ["type", "modifier", "prefix", "value", "suffix"]) {
            if (i[h] < o[h])
              return -1;
            if (i[h] === o[h])
              continue;
            return 1;
          }
          return 0;
        }, "comparePart"), l = new P(3, "", "", "", "", 3), f = new P(0, "", "", "", "", 3), s = a((i, o) => {
          let h = 0;
          for (; h < Math.min(i.length, o.length); ++h) {
            let p = c(i[h], o[h]);
            if (p)
              return p;
          }
          return i.length === o.length ? 0 : c(i[h] ?? l, o[h] ?? l);
        }, "comparePartList");
        return !r.#e[t] && !n.#e[t] ? 0 : r.#e[t] && !n.#e[t] ? s(r.#s[t], [f]) : !r.#e[t] && n.#e[t] ? s([f], n.#s[t]) : s(r.#s[t], n.#s[t]);
      }
      get protocol() {
        return this.#e.protocol;
      }
      get username() {
        return this.#e.username;
      }
      get password() {
        return this.#e.password;
      }
      get hostname() {
        return this.#e.hostname;
      }
      get port() {
        return this.#e.port;
      }
      get pathname() {
        return this.#e.pathname;
      }
      get search() {
        return this.#e.search;
      }
      get hash() {
        return this.#e.hash;
      }
      get hasRegExpGroups() {
        return this.#l;
      }
    };
    a(Y, "URLPattern");
  }
});
var urlpattern_polyfill_exports = {};
__export(urlpattern_polyfill_exports, {
  URLPattern: /* @__PURE__ */ __name(() => Y, "URLPattern")
});
var init_urlpattern_polyfill = __esm({
  "packages/match-pattern/node_modules/urlpattern-polyfill/index.js"() {
    init_urlpattern();
    if (!globalThis.URLPattern) {
      globalThis.URLPattern = Y;
    }
  }
});
var URLPattern = globalThis.URLPattern;
if (!URLPattern) {
  await Promise.resolve().then(() => (init_urlpattern_polyfill(), urlpattern_polyfill_exports));
  URLPattern = globalThis.URLPattern;
}
var MatchPattern = class extends URLPattern {
  static {
    __name(this, "MatchPattern");
  }
  _originalInput;
  constructor(input, baseURL) {
    let processedInput = input;
    if (typeof input === "string") {
      processedInput = parseStringPattern(input);
    }
    const normalizedInput = normalizePatternTrailingSlash(processedInput);
    if (baseURL !== void 0) {
      super(normalizedInput, baseURL);
    } else {
      super(normalizedInput);
    }
    this._originalInput = normalizedInput;
  }
  /**
   * Enhanced exec that returns unified params object with trailing slash normalization
   */
  exec(input) {
    if (!this.test(input)) {
      return null;
    }
    const url = typeof input === "string" ? new URL(input) : input;
    const normalizedUrl = normalizeTrailingSlash(url);
    const result = super.exec(normalizedUrl);
    if (result) {
      const enhancedResult = {
        ...result,
        params: extractUnifiedParams(result, input)
        // Use original input for search params
      };
      return enhancedResult;
    }
    return buildCustomResult(this, input);
  }
  /**
   * Enhanced test with order-independent search parameter matching and trailing slash normalization
   */
  test(input) {
    const url = typeof input === "string" ? new URL(input) : input;
    const normalizedUrl = normalizeTrailingSlash(url);
    if (!this.search || this.search === "*") {
      return super.test(normalizedUrl);
    }
    const pathPatternInit = typeof this._originalInput === "string" ? { pathname: this._originalInput } : { ...this._originalInput, search: void 0 };
    const normalizedPattern = normalizePatternTrailingSlash(pathPatternInit);
    const pathPattern = new URLPattern(normalizedPattern);
    if (!pathPattern.test(normalizedUrl)) {
      return false;
    }
    return testSearchParameters(this.search, url.searchParams);
  }
};
function parseStringPattern(pattern) {
  if (pattern.includes("://")) {
    const ampIndex2 = pattern.indexOf("&");
    if (ampIndex2 === -1) {
      return pattern;
    }
    const urlPart = pattern.slice(0, ampIndex2);
    const search2 = pattern.slice(ampIndex2 + 1);
    try {
      const url = new URL(urlPart.replace(/:(\w+)/g, "placeholder"));
      return {
        protocol: urlPart.split("://")[0],
        hostname: url.hostname,
        pathname: url.pathname.replace(/placeholder/g, ":$1"),
        // Restore params
        search: search2
      };
    } catch {
      return pattern;
    }
  }
  const ampIndex = pattern.indexOf("&");
  if (ampIndex === -1) {
    return { pathname: pattern };
  }
  if (ampIndex === 0) {
    return { search: pattern.slice(1) };
  }
  const pathname = pattern.slice(0, ampIndex);
  const search = pattern.slice(ampIndex + 1);
  return { pathname, search };
}
__name(parseStringPattern, "parseStringPattern");
function extractUnifiedParams(result, url) {
  const params = {};
  if (result.pathname?.groups) {
    for (const [key, value] of Object.entries(result.pathname.groups)) {
      if (value !== void 0) {
        params[key] = value;
      }
    }
  }
  if (result.search?.groups) {
    const actualUrl = typeof url === "string" ? new URL(url) : url;
    const searchParams = actualUrl.searchParams;
    for (const [key, value] of searchParams) {
      params[key] = value;
    }
  } else if (typeof url !== "string") {
    const actualUrl = url instanceof URL ? url : new URL(url);
    for (const [key, value] of actualUrl.searchParams) {
      params[key] = value;
    }
  }
  return params;
}
__name(extractUnifiedParams, "extractUnifiedParams");
function normalizeTrailingSlash(url) {
  const normalized = new URL(url.href);
  if (normalized.pathname === "/") {
    return normalized;
  }
  if (normalized.pathname.endsWith("/")) {
    normalized.pathname = normalized.pathname.slice(0, -1);
  }
  return normalized;
}
__name(normalizeTrailingSlash, "normalizeTrailingSlash");
function normalizePatternTrailingSlash(patternInit) {
  if (typeof patternInit === "string") {
    if (patternInit === "/" || patternInit === "") {
      return patternInit;
    }
    return patternInit.endsWith("/") ? patternInit.slice(0, -1) : patternInit;
  }
  const normalized = { ...patternInit };
  if (normalized.pathname && normalized.pathname !== "/") {
    if (normalized.pathname.endsWith("/")) {
      normalized.pathname = normalized.pathname.slice(0, -1);
    }
  }
  return normalized;
}
__name(normalizePatternTrailingSlash, "normalizePatternTrailingSlash");
function buildCustomResult(pattern, input) {
  const url = typeof input === "string" ? new URL(input) : input;
  const result = {
    inputs: [input],
    pathname: { input: url.pathname, groups: {} },
    search: { input: url.search, groups: {} },
    hash: { input: url.hash, groups: {} },
    protocol: { input: url.protocol, groups: {} },
    hostname: { input: url.hostname, groups: {} },
    port: { input: url.port, groups: {} },
    username: { input: url.username, groups: {} },
    password: { input: url.password, groups: {} },
    params: {}
  };
  if (pattern.pathname && pattern.pathname !== "*") {
    const pathPattern = new URLPattern({ pathname: pattern.pathname });
    const pathResult = pathPattern.exec(url);
    if (pathResult?.pathname?.groups) {
      result.pathname.groups = pathResult.pathname.groups;
    }
  }
  if (pattern.search && pattern.search !== "*") {
    const searchParams = parseSearchPattern(pattern.search);
    const actualParams = url.searchParams;
    for (const [key, paramDef] of searchParams) {
      if (actualParams.has(key)) {
        if (paramDef.type === "named" && paramDef.name) {
          result.search.groups[paramDef.name] = actualParams.get(key);
        }
      }
    }
  }
  result.params = extractUnifiedParams(result, input);
  return result;
}
__name(buildCustomResult, "buildCustomResult");
function testSearchParameters(searchPattern, actualParams) {
  const patternParams = parseSearchPattern(searchPattern);
  for (const [key, paramPattern] of patternParams) {
    if (!actualParams.has(key)) {
      return false;
    }
    if (paramPattern.type === "literal") {
      if (actualParams.get(key) !== paramPattern.value) {
        return false;
      }
    }
  }
  return true;
}
__name(testSearchParameters, "testSearchParameters");
function parseSearchPattern(pattern) {
  const params = /* @__PURE__ */ new Map();
  const parts = pattern.split("&");
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (!key || !value)
      continue;
    if (value.startsWith(":")) {
      const isOptional = value.endsWith("?");
      params.set(key, {
        type: "named",
        name: value.slice(1, isOptional ? -1 : void 0),
        optional: isOptional
      });
    } else if (value === "*") {
      params.set(key, { type: "wildcard" });
    } else {
      params.set(key, { type: "literal", value });
    }
  }
  return params;
}
__name(parseSearchPattern, "parseSearchPattern");
var LinearExecutor = class {
  static {
    __name(this, "LinearExecutor");
  }
  constructor(routes) {
    this.routes = routes;
  }
  /**
   * Find the first route that matches the request
   * Returns null if no route matches
   */
  match(request) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }
      if (route.pattern.test(url)) {
        const result = route.pattern.exec(url);
        if (result) {
          return {
            handler: route.handler,
            context: {
              params: result.params
            },
            cacheConfig: route.cache
          };
        }
      }
    }
    return null;
  }
};
var RouteBuilder = class {
  static {
    __name(this, "RouteBuilder");
  }
  constructor(router2, pattern, cacheConfig) {
    this.router = router2;
    this.pattern = pattern;
    this.cacheConfig = cacheConfig;
  }
  /**
   * Register a GET handler for this route pattern
   */
  get(handler) {
    this.router.addRoute("GET", this.pattern, handler, this.cacheConfig);
    return this;
  }
  /**
   * Register a POST handler for this route pattern
   */
  post(handler) {
    this.router.addRoute("POST", this.pattern, handler, this.cacheConfig);
    return this;
  }
  /**
   * Register a PUT handler for this route pattern
   */
  put(handler) {
    this.router.addRoute("PUT", this.pattern, handler, this.cacheConfig);
    return this;
  }
  /**
   * Register a DELETE handler for this route pattern
   */
  delete(handler) {
    this.router.addRoute("DELETE", this.pattern, handler, this.cacheConfig);
    return this;
  }
  /**
   * Register a PATCH handler for this route pattern
   */
  patch(handler) {
    this.router.addRoute("PATCH", this.pattern, handler, this.cacheConfig);
    return this;
  }
  /**
   * Register a HEAD handler for this route pattern
   */
  head(handler) {
    this.router.addRoute("HEAD", this.pattern, handler, this.cacheConfig);
    return this;
  }
  /**
   * Register an OPTIONS handler for this route pattern
   */
  options(handler) {
    this.router.addRoute("OPTIONS", this.pattern, handler, this.cacheConfig);
    return this;
  }
  /**
   * Register a handler for all HTTP methods on this route pattern
   */
  all(handler) {
    const methods = [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
      "HEAD",
      "OPTIONS"
    ];
    methods.forEach((method) => {
      this.router.addRoute(method, this.pattern, handler, this.cacheConfig);
    });
    return this;
  }
};
var Router = class {
  static {
    __name(this, "Router");
  }
  routes = [];
  middlewares = [];
  executor = null;
  dirty = false;
  caches;
  constructor(options) {
    this.caches = options?.caches;
  }
  use(patternOrMiddleware, handler) {
    if (typeof patternOrMiddleware === "string" && handler) {
      this.addRoute("GET", patternOrMiddleware, handler);
      this.addRoute("POST", patternOrMiddleware, handler);
      this.addRoute("PUT", patternOrMiddleware, handler);
      this.addRoute("DELETE", patternOrMiddleware, handler);
      this.addRoute("PATCH", patternOrMiddleware, handler);
      this.addRoute("HEAD", patternOrMiddleware, handler);
      this.addRoute("OPTIONS", patternOrMiddleware, handler);
    } else if (typeof patternOrMiddleware === "function") {
      if (!this.isValidMiddleware(patternOrMiddleware)) {
        throw new Error(
          "Invalid middleware type. Must be function or async generator function."
        );
      }
      this.middlewares.push({ middleware: patternOrMiddleware });
      this.dirty = true;
    } else {
      throw new Error(
        "Invalid middleware type. Must be function or async generator function."
      );
    }
  }
  route(patternOrConfig) {
    if (typeof patternOrConfig === "string") {
      return new RouteBuilder(this, patternOrConfig);
    } else {
      return new RouteBuilder(
        this,
        patternOrConfig.pattern,
        patternOrConfig.cache
      );
    }
  }
  /**
   * Internal method called by RouteBuilder to register routes
   * Public for RouteBuilder access, but not intended for direct use
   */
  addRoute(method, pattern, handler, cache) {
    const matchPattern = new MatchPattern(pattern);
    this.routes.push({
      pattern: matchPattern,
      method: method.toUpperCase(),
      handler,
      cache
    });
    this.dirty = true;
  }
  /**
   * Handle a request - main entrypoint for ServiceWorker usage
   * Returns a response or throws if no route matches
   */
  handler = /* @__PURE__ */ __name(async (request) => {
    if (this.dirty || !this.executor) {
      this.executor = new LinearExecutor(this.routes);
      this.dirty = false;
    }
    const matchResult = this.executor.match(request);
    if (matchResult) {
      const context2 = await this.buildContext(
        matchResult.context,
        matchResult.cacheConfig
      );
      const mutableRequest = this.createMutableRequest(request);
      return this.executeMiddlewareStack(
        this.middlewares,
        mutableRequest,
        context2,
        matchResult.handler,
        request.url,
        this.executor
      );
    } else {
      const notFoundHandler = /* @__PURE__ */ __name(async () => {
        return new Response("Not Found", { status: 404 });
      }, "notFoundHandler");
      const mutableRequest = this.createMutableRequest(request);
      return this.executeMiddlewareStack(
        this.middlewares,
        mutableRequest,
        { params: {} },
        notFoundHandler,
        request.url,
        this.executor
      );
    }
  }, "handler");
  /**
   * Match a request against registered routes and execute the handler chain
   * Returns the response from the matched handler, or null if no route matches
   * Note: Global middleware executes even if no route matches
   */
  async match(request) {
    if (this.dirty || !this.executor) {
      this.executor = new LinearExecutor(this.routes);
      this.dirty = false;
    }
    const mutableRequest = this.createMutableRequest(request);
    const originalUrl = mutableRequest.url;
    let matchResult = this.executor.match(request);
    let handler;
    let context2;
    if (matchResult) {
      handler = matchResult.handler;
      context2 = await this.buildContext(
        matchResult.context,
        matchResult.cacheConfig
      );
    } else {
      handler = /* @__PURE__ */ __name(async () => new Response("Not Found", { status: 404 }), "handler");
      context2 = { params: {} };
    }
    const response = await this.executeMiddlewareStack(
      this.middlewares,
      mutableRequest,
      context2,
      handler,
      originalUrl,
      this.executor
      // Pass executor for re-routing
    );
    if (!matchResult && response?.status === 404) {
      return null;
    }
    return response;
  }
  /**
   * Build the complete route context including cache access
   */
  async buildContext(baseContext, cacheConfig) {
    const context2 = { ...baseContext };
    if (this.caches) {
      context2.caches = this.caches;
      if (cacheConfig?.name) {
        try {
          context2.cache = await this.caches.open(cacheConfig.name);
        } catch (error3) {
          console.warn(`Failed to open cache '${cacheConfig.name}':`, error3);
        }
      }
    }
    return context2;
  }
  /**
   * Get registered routes for debugging/introspection
   */
  getRoutes() {
    return [...this.routes];
  }
  /**
   * Get registered middleware for debugging/introspection
   */
  getMiddlewares() {
    return [...this.middlewares];
  }
  /**
   * Mount a subrouter at a specific path prefix
   * All routes from the subrouter will be prefixed with the mount path
   *
   * Example:
   *   const apiRouter = new Router();
   *   apiRouter.route('/users').get(getUsersHandler);
   *   apiRouter.route('/users/:id').get(getUserHandler);
   *
   *   const mainRouter = new Router();
   *   mainRouter.mount('/api/v1', apiRouter);
   *   // Routes become: /api/v1/users, /api/v1/users/:id
   */
  mount(mountPath, subrouter) {
    const normalizedMountPath = this.normalizeMountPath(mountPath);
    const subroutes = subrouter.getRoutes();
    for (const subroute of subroutes) {
      const mountedPattern = this.combinePaths(
        normalizedMountPath,
        subroute.pattern.pathname
      );
      this.routes.push({
        pattern: new MatchPattern(mountedPattern),
        method: subroute.method,
        handler: subroute.handler,
        cache: subroute.cache
      });
    }
    const submiddlewares = subrouter.getMiddlewares();
    for (const submiddleware of submiddlewares) {
      this.middlewares.push(submiddleware);
    }
    this.dirty = true;
  }
  /**
   * Normalize mount path: ensure it starts with / and doesn't end with /
   */
  normalizeMountPath(mountPath) {
    if (!mountPath.startsWith("/")) {
      mountPath = "/" + mountPath;
    }
    if (mountPath.endsWith("/") && mountPath.length > 1) {
      mountPath = mountPath.slice(0, -1);
    }
    return mountPath;
  }
  /**
   * Combine mount path with route pattern
   */
  combinePaths(mountPath, routePattern) {
    if (routePattern === "/") {
      return mountPath;
    }
    if (!routePattern.startsWith("/")) {
      routePattern = "/" + routePattern;
    }
    return mountPath + routePattern;
  }
  /**
   * Validate that a function is valid middleware
   */
  isValidMiddleware(middleware) {
    const constructorName = middleware.constructor.name;
    return constructorName === "AsyncGeneratorFunction" || constructorName === "AsyncFunction" || constructorName === "Function";
  }
  /**
   * Detect if a function is a generator middleware
   */
  isGeneratorMiddleware(middleware) {
    return middleware.constructor.name === "AsyncGeneratorFunction";
  }
  /**
   * Execute middleware stack with guaranteed execution using Rack-style LIFO order
   */
  async executeMiddlewareStack(middlewares, request, context2, handler, originalUrl, executor) {
    const runningGenerators = [];
    let currentResponse = null;
    for (let i = 0; i < middlewares.length; i++) {
      const middleware = middlewares[i].middleware;
      if (this.isGeneratorMiddleware(middleware)) {
        const generator = middleware(request, context2);
        const result = await generator.next();
        if (result.done) {
          if (result.value) {
            currentResponse = result.value;
            break;
          }
        } else {
          runningGenerators.push({ generator, index: i });
        }
      } else {
        const result = await middleware(request, context2);
        if (result) {
          currentResponse = result;
          break;
        }
      }
    }
    if (!currentResponse) {
      let finalHandler = handler;
      let finalContext = context2;
      if (request.url !== originalUrl && executor) {
        const newMatchResult = executor.match(
          new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body
          })
        );
        if (newMatchResult) {
          finalHandler = newMatchResult.handler;
          finalContext = await this.buildContext(
            newMatchResult.context,
            newMatchResult.cacheConfig || void 0
          );
        }
      }
      let handlerError = null;
      try {
        currentResponse = await finalHandler(request, finalContext);
      } catch (error3) {
        handlerError = error3;
      }
      if (handlerError) {
        currentResponse = await this.handleErrorThroughGenerators(
          handlerError,
          runningGenerators
        );
      }
    }
    if (request.url !== originalUrl && currentResponse) {
      currentResponse = this.handleAutomaticRedirect(
        originalUrl,
        request.url,
        request.method
      );
    }
    for (let i = runningGenerators.length - 1; i >= 0; i--) {
      const { generator } = runningGenerators[i];
      const result = await generator.next(currentResponse);
      if (result.value) {
        currentResponse = result.value;
      }
    }
    return currentResponse;
  }
  /**
   * Handle errors by trying generators in reverse order
   */
  async handleErrorThroughGenerators(error3, runningGenerators) {
    for (let i = runningGenerators.length - 1; i >= 0; i--) {
      const { generator } = runningGenerators[i];
      try {
        const result = await generator.throw(error3);
        if (result.value) {
          runningGenerators.splice(i, 1);
          return result.value;
        }
      } catch (generatorError) {
        runningGenerators.splice(i, 1);
        continue;
      }
    }
    throw error3;
  }
  /**
   * Create a mutable request wrapper that allows URL modification
   */
  createMutableRequest(request) {
    return {
      url: request.url,
      method: request.method,
      headers: new Headers(request.headers),
      body: request.body,
      bodyUsed: request.bodyUsed,
      cache: request.cache,
      credentials: request.credentials,
      destination: request.destination,
      integrity: request.integrity,
      keepalive: request.keepalive,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      signal: request.signal,
      // Add all other Request methods
      arrayBuffer: /* @__PURE__ */ __name(() => request.arrayBuffer(), "arrayBuffer"),
      blob: /* @__PURE__ */ __name(() => request.blob(), "blob"),
      clone: /* @__PURE__ */ __name(() => request.clone(), "clone"),
      formData: /* @__PURE__ */ __name(() => request.formData(), "formData"),
      json: /* @__PURE__ */ __name(() => request.json(), "json"),
      text: /* @__PURE__ */ __name(() => request.text(), "text")
    };
  }
  /**
   * Handle automatic redirects when URL is modified
   */
  handleAutomaticRedirect(originalUrl, newUrl, method) {
    const originalURL = new URL(originalUrl);
    const newURL = new URL(newUrl);
    if (originalURL.hostname !== newURL.hostname || originalURL.port !== newURL.port && originalURL.port !== "" && newURL.port !== "") {
      throw new Error(
        `Cross-origin redirect not allowed: ${originalUrl} -> ${newUrl}`
      );
    }
    let status = 302;
    if (originalURL.protocol !== newURL.protocol) {
      status = 301;
    } else if (method.toUpperCase() !== "GET") {
      status = 307;
    }
    return new Response(null, {
      status,
      headers: {
        Location: newUrl
      }
    });
  }
  /**
   * Get route statistics
   */
  getStats() {
    return {
      routeCount: this.routes.length,
      middlewareCount: this.middlewares.length,
      compiled: !this.dirty && this.executor !== null
    };
  }
};
var DEFAULT_MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg"
};
function getMimeType(filePath, customTypes = {}) {
  const ext = "." + filePath.split(".").pop()?.toLowerCase();
  return customTypes[ext] || DEFAULT_MIME_TYPES[ext] || "application/octet-stream";
}
__name(getMimeType, "getMimeType");
function createAssetsMiddleware(config2 = {}) {
  const {
    directory = "assets",
    basePath = "/assets",
    manifestPath = "manifest.json",
    cacheControl = config2.dev ? "no-cache" : "public, max-age=31536000",
    dev = false,
    mimeTypes = {}
  } = config2;
  let manifestCache = null;
  let manifestError = null;
  async function loadManifest() {
    if (manifestCache)
      return manifestCache;
    if (manifestError && !dev)
      throw new Error(manifestError);
    try {
      const assetsDir = await self.dirs.open(directory);
      const manifestHandle = await assetsDir.getFileHandle(manifestPath);
      const manifestFile = await manifestHandle.getFile();
      const manifestText = await manifestFile.text();
      const manifest = JSON.parse(manifestText);
      const urlMap = {};
      if (manifest.assets) {
        for (const [, entry] of Object.entries(manifest.assets)) {
          if (entry && typeof entry === "object" && "url" in entry) {
            const url = entry.url;
            const filename = url.split("/").pop();
            if (filename) {
              urlMap[filename] = entry;
            }
          }
        }
      }
      manifestCache = urlMap;
      manifestError = null;
      return manifestCache;
    } catch (error3) {
      manifestError = `Failed to load manifest: ${error3.message}`;
      if (dev) {
        return {};
      }
      throw new Error(manifestError);
    }
  }
  __name(loadManifest, "loadManifest");
  return /* @__PURE__ */ __name(async function* assetsMiddleware(request, context2) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(basePath)) {
      const response = yield request;
      return response;
    }
    const requestedPath = url.pathname.slice(basePath.length);
    if (requestedPath.includes("..") || requestedPath.includes("//")) {
      return new Response("Forbidden", { status: 403 });
    }
    const requestedFilename = requestedPath.replace(/^\/+/, "") || "index.html";
    try {
      const manifest = await loadManifest();
      const manifestEntry = manifest[requestedFilename];
      if (!manifestEntry && !dev) {
        return new Response("Not Found", { status: 404 });
      }
      const assetsDir = await self.dirs.open(directory);
      const fileHandle = await assetsDir.getFileHandle(requestedFilename);
      const file = await fileHandle.getFile();
      const contentType = manifestEntry?.type || getMimeType(requestedFilename, mimeTypes);
      const headers = new Headers({
        "Content-Type": contentType,
        "Content-Length": manifestEntry?.size?.toString() || file.size.toString(),
        "Cache-Control": cacheControl,
        "Last-Modified": new Date(file.lastModified).toUTCString()
      });
      if (manifestEntry?.hash) {
        headers.set("ETag", `"${manifestEntry.hash}"`);
      }
      const ifModifiedSince = request.headers.get("if-modified-since");
      if (ifModifiedSince) {
        const modifiedSince = new Date(ifModifiedSince);
        const lastModified = new Date(file.lastModified);
        if (lastModified <= modifiedSince) {
          return new Response(null, {
            status: 304,
            headers: new Headers({
              "Cache-Control": cacheControl,
              "Last-Modified": headers.get("Last-Modified")
            })
          });
        }
      }
      return new Response(file.stream(), {
        status: 200,
        headers
      });
    } catch (error3) {
      if (error3.name === "NotFoundError") {
        return new Response("Not Found", { status: 404 });
      }
      return new Response("Internal Server Error", { status: 500 });
    }
  }, "assetsMiddleware");
}
__name(createAssetsMiddleware, "createAssetsMiddleware");
var styles_default = "/assets/styles-7db9ca52.css";
var logo_default = "/assets/logo-5567cb6e.svg";
var CACHE_HEADERS = {
  ASSETS: "public, max-age=31536000, immutable",
  // 1 year for assets
  PAGES: "public, max-age=300",
  // 5 minutes for pages
  POSTS: "public, max-age=600",
  // 10 minutes for posts  
  API: "public, max-age=180",
  // 3 minutes for API
  ABOUT: "public, max-age=3600"
  // 1 hour for about page
};
var TIMEOUTS = {
  ROUTER_RESPONSE: 5e3
  // 5 seconds for router timeout
};
var router = new Router();
router.use(
  createAssetsMiddleware({
    directory: "assets",
    basePath: "/assets",
    manifestPath: "manifest.json",
    dev: false,
    cacheControl: true ? CACHE_HEADERS.ASSETS : "no-cache"
  })
);
router.use(pageCache);
async function* pageCache(request, context2) {
  if (request.method !== "GET" || !self.caches) {
    const response2 = yield request;
    return response2;
  }
  const cache = await self.caches.open("pages");
  let cached;
  try {
    const requestClone = request.clone();
    cached = await cache.match(requestClone);
  } catch (error3) {
    cached = null;
  }
  if (cached) {
    const response2 = cached.clone();
    response2.headers.set("X-Cache", "HIT");
    return response2;
  }
  const response = yield request;
  if (response.ok) {
    const requestForCache = new Request(request.url, {
      method: request.method,
      headers: request.headers
    });
    await cache.put(requestForCache, response.clone());
  }
  response.headers.set("X-Cache", "MISS");
  return response;
}
__name(pageCache, "pageCache");
var posts = [
  {
    id: 1,
    title: "Welcome to Shovel!",
    content: "Shovel is a cache-first metaframework that makes building fast web apps easy. With its Django-inspired app architecture, you can compose exactly the functionality you need.",
    author: "Shovel Team",
    date: "2024-01-15"
  },
  {
    id: 2,
    title: "Cache-First Architecture",
    content: "Every request goes through the cache first. This means your app is fast by default, whether you deploy as SSG, SSR, or SPA.",
    author: "Shovel Team",
    date: "2024-01-14"
  },
  {
    id: 3,
    title: "Static Files Made Easy",
    content: 'Import any asset with `with { url: "/static/" }` and Shovel handles the rest - content hashing, manifest generation, and optimized serving.',
    author: "Shovel Team",
    date: "2024-01-13"
  }
];
router.route({
  pattern: "/"
}).get(async (request, context2) => {
  return new Response(
    renderPage(
      "Home",
      `
    <div class="cache-info">
      <strong>Cache Status:</strong> ${self.caches ? "Enabled" : "Disabled"} | 
      <strong>Cache Type:</strong> ${self.caches ? "Platform-configured" : "N/A"}
    </div>
    
    <div class="posts">
      ${posts.map(
        (post) => `
        <article class="post">
          <h2><a href="/posts/${post.id}">${post.title}</a></h2>
          <div class="meta">By ${post.author} on ${post.date}</div>
          <p>${post.content}</p>
        </article>
      `
      ).join("")}
    </div>
  `
    ),
    {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": CACHE_HEADERS.PAGES
      }
    }
  );
});
router.route({
  pattern: "/posts/:id"
}).get(async (request, context2) => {
  const post = posts.find((p) => p.id === parseInt(context2.params.id));
  if (!post) {
    return new Response(
      renderPage(
        "Post Not Found",
        `
      <div class="post">
        <h2>Post Not Found</h2>
        <p>The post you're looking for doesn't exist.</p>
        <p><a href="/">\u2190 Back to Home</a></p>
      </div>
    `
      ),
      { status: 404, headers: { "Content-Type": "text/html" } }
    );
  }
  return new Response(
    renderPage(
      post.title,
      `
    <div class="cache-info">
      <strong>Cache Status:</strong> ${self.caches ? "Enabled" : "Disabled"} | 
      <strong>Post ID:</strong> ${post.id}
    </div>
    
    <article class="post">
      <h2>${post.title}</h2>
      <div class="meta">By ${post.author} on ${post.date}</div>
      <p>${post.content}</p>
      <p><a href="/">\u2190 Back to Home</a></p>
    </article>
  `
    ),
    {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": CACHE_HEADERS.POSTS
      }
    }
  );
});
router.route({
  pattern: "/api/posts"
}).get(async (request, context2) => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  return Response.json(
    {
      posts: posts.map((p) => ({
        id: p.id,
        title: p.title,
        author: p.author,
        date: p.date
      })),
      cached: !!self.caches,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    },
    {
      headers: {
        "Cache-Control": CACHE_HEADERS.API
      }
    }
  );
});
router.route({
  pattern: "/about"
}).get(async (request, context2) => {
  return new Response(
    renderPage(
      "About",
      `
    <div class="post">
      <h2>About This App</h2>
      <p>This is a demo blog built with Shovel's cache-first architecture. It showcases:</p>
      <ul>
        <li><strong>@b9g/router</strong> - Universal request routing with middleware</li>
        <li><strong>@b9g/cache</strong> - Multiple cache strategies (pages, API, static)</li>
        <li><strong>@b9g/staticfiles</strong> - Django-style static file handling</li>
        <li><strong>@b9g/match-pattern</strong> - Enhanced URLPattern matching</li>
      </ul>
      
      <div class="cache-info">
        <strong>Cache Statistics:</strong><br>
        Platform Caches: ${self.caches ? "Available" : "Not Available"}<br>
        Static Files: Served from ${true ? "optimized build" : "source files"}
      </div>
      
      <p><a href="/">\u2190 Back to Home</a></p>
    </div>
  `
    ),
    {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": CACHE_HEADERS.ABOUT
      }
    }
  );
});
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(generateStaticSite());
});
async function generateStaticSite() {
  console.info("[Blog App] Starting static site generation...");
  try {
    const staticDir = await self.dirs.open("static");
    const assetsDir = await self.dirs.open("assets");
    console.info("[Blog App] Copying assets...");
    await copyAssetsToStatic(assetsDir, staticDir);
    const staticRoutes = [
      "/",
      "/about",
      "/api/posts",
      ...posts.map((post) => `/posts/${post.id}`)
    ];
    console.info(`[Blog App] Pre-rendering ${staticRoutes.length} routes...`);
    for (const route of staticRoutes) {
      try {
        const request = new Request(`http://localhost:3000${route}`);
        const response = await router.handler(request);
        if (response.ok) {
          const content = await response.text();
          let fileName;
          if (route === "/") {
            fileName = "index.html";
          } else if (route.startsWith("/api/")) {
            fileName = `${route.slice(5)}.json`;
          } else {
            fileName = `${route.slice(1).replace(/\//g, "-")}.html`;
          }
          const fileHandle = await staticDir.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(content);
          await writable.close();
          console.info(`[Blog App] \u2705 Generated ${route} -> ${fileName}`);
        } else {
          console.warn(`[Blog App] \u26A0\uFE0F  ${route} returned ${response.status}`);
        }
      } catch (error3) {
        console.error(`[Blog App] \u274C Failed to generate ${route}:`, error3.message);
      }
    }
    console.info("[Blog App] \u2705 Static site generation complete!");
  } catch (error3) {
    console.error("[Blog App] \u274C Static site generation failed:", error3.message);
  }
}
__name(generateStaticSite, "generateStaticSite");
async function copyAssetsToStatic(assetsDir, staticDir) {
  try {
    const staticAssetsDir = await staticDir.getDirectoryHandle("assets", { create: true });
    for await (const [name, handle] of assetsDir.entries()) {
      if (handle.kind === "file") {
        const file = await handle.getFile();
        const content = await file.arrayBuffer();
        const targetHandle = await staticAssetsDir.getFileHandle(name, { create: true });
        const writable = await targetHandle.createWritable();
        await writable.write(content);
        await writable.close();
        console.info(`[Blog App] Copied asset: ${name}`);
      }
    }
    console.info("[Blog App] \u2705 Assets copied to static/assets/");
  } catch (error3) {
    console.error("[Blog App] \u274C Failed to copy assets:", error3.message);
  }
}
__name(copyAssetsToStatic, "copyAssetsToStatic");
self.addEventListener("fetch", (event) => {
  try {
    const responsePromise = router.handler(event.request);
    const timeoutPromise = new Promise((_2, reject) => {
      setTimeout(() => reject(new Error("Router response timeout")), TIMEOUTS.ROUTER_RESPONSE);
    });
    event.respondWith(
      Promise.race([responsePromise, timeoutPromise]).catch((error3) => {
        return new Response("Router error: " + error3.message, { status: 500 });
      })
    );
  } catch (error3) {
    event.respondWith(
      new Response("Sync error: " + error3.message, { status: 500 })
    );
  }
});
self.addEventListener("static", (event) => {
  event.waitUntil(
    (async () => {
      const staticRoutes = [
        "/",
        "/about",
        "/api/posts",
        ...posts.map((post) => `/posts/${post.id}`)
      ];
      return staticRoutes;
    })()
  );
});
function renderPage(title2, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title2} - Shovel Blog</title>
  <link rel="stylesheet" href="${styles_default}">
  <link rel="icon" href="${logo_default}">
</head>
<body>
  <header>
    <img src="${logo_default}" alt="Shovel" width="48" height="48">
    <h1>Shovel Blog</h1>
    <p class="subtitle">Cache-First Metaframework Demo</p>
  </header>
  
  <nav>
    <a href="/">Home</a>
    <a href="/about">About</a>
    <a href="/api/posts">API</a>
  </nav>
  
  <main>
    ${content}
  </main>
  
  <footer>
    <p>Built with \u2764\uFE0F using <strong>Shovel</strong> - A cache-first metaframework</p>
    <p><small>Static files: ${styles_default} | ${logo_default}</small></p>
  </footer>
</body>
</html>`;
}
__name(renderPage, "renderPage");
var app_default = {
  async fetch(request, env2, ctx) {
    if (!globalThis.self.dirs) {
      globalThis.self.dirs = {
        async open(bucketName) {
          if (bucketName === "assets" && env2.ASSETS) {
            return env2.ASSETS;
          }
          throw new Error(`Bucket ${bucketName} not configured`);
        }
      };
    }
    if (!globalThis.self.caches) {
      globalThis.self.caches = globalThis.caches;
    }
    for (const handler of fetchHandlers) {
      const event = { request, respondWith: null };
      event.respondWith = (response) => {
        event.response = response;
      };
      try {
        await handler(event);
        if (event.response) {
          return event.response;
        }
      } catch (error3) {
        return new Response("ServiceWorker error: " + error3.message, { status: 500 });
      }
    }
    return new Response("No ServiceWorker handler", { status: 404 });
  }
};

// ../../../../.bun/install/global/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../.bun/install/global/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } catch (e) {
    const error3 = reduceError(e);
    return Response.json(error3, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-KX24yY/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = app_default;

// ../../../../.bun/install/global/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env2, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env2, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env2, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env2, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-KX24yY/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env2, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env2, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env2, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env2, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env2, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env2, ctx) => {
      this.env = env2;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=app.js.map
