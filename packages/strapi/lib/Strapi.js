'use strict';

// Dependencies.
const http = require('http');
const path = require('path');
const { EventEmitter } = require('events');
const fse = require('fs-extra');
const Koa = require('koa');
const Router = require('koa-router');
const _ = require('lodash');
const { logger, models } = require('strapi-utils');
const utils = require('./utils');
const {
  loadConfig,
  loadApis,
  loadAdmin,
  loadPlugins,
  loadMiddlewares,
  loadHooks,
  bootstrap,
  loadExtensions,
  initCoreStore,
  loadGroups,
} = require('./core');
const initializeMiddlewares = require('./middlewares');
const initializeHooks = require('./hooks');
const createStrapiFs = require('./core/fs');
const getPrefixedDeps = require('./utils/get-prefixed-dependencies');

const { initializeDatabase } = require('strapi-dbal');

/**
 * Construct an Strapi instance.
 *
 * @constructor
 */

class Strapi extends EventEmitter {
  constructor({ dir, autoReload = false } = {}) {
    super();

    this.setMaxListeners(100);

    this.reload = this.reload();

    // Expose `koa`.
    this.app = new Koa();
    this.router = new Router();

    // Mount the HTTP server.
    this.server = http.createServer(this.app.callback());

    // Logger.
    this.log = logger;

    // Utils.
    this.utils = {
      models,
    };

    // Exclude EventEmitter, Koa and HTTP server to be freezed.
    this.propertiesToNotFreeze = Object.keys(this);

    // Expose `admin`.
    this.admin = {};

    // Expose `plugin`.
    this.plugins = {};

    this.dir = dir || process.cwd();
    const pkgJSON = require(path.resolve(this.dir, 'package.json'));

    // Default configurations.
    this.config = {
      launchedAt: Date.now(),
      appPath: this.dir,
      autoReload,
      host: process.env.HOST || process.env.HOSTNAME || 'localhost',
      port: process.env.PORT || 1337,
      environment: _.toLower(process.env.NODE_ENV) || 'development',
      environments: {},
      admin: {},
      paths: {
        admin: 'admin',
        api: 'api',
        config: 'config',
        controllers: 'controllers',
        models: 'models',
        plugins: 'plugins',
        policies: 'policies',
        tmp: '.tmp',
        services: 'services',
        static: 'public',
        validators: 'validators',
        views: 'views',
      },
      middleware: {},
      hook: {},
      functions: {},
      routes: {},
      info: pkgJSON,
      installedPlugins: getPrefixedDeps('strapi-plugin', pkgJSON),
      installedMiddlewares: getPrefixedDeps('strapi-middleware', pkgJSON),
      installedHooks: getPrefixedDeps('strapi-hook', pkgJSON),
    };

    this.fs = createStrapiFs(this);
    this.requireProjectBootstrap();
  }

  requireProjectBootstrap() {
    const bootstrapPath = path.resolve(
      this.dir,
      'config/functions/bootstrap.js'
    );

    if (fse.existsSync(bootstrapPath)) {
      require(bootstrapPath);
    }
  }

  async start(cb) {
    try {
      // Emit starting event.
      this.emit('server:starting');

      await this.load();

      // Run bootstrap function.
      await this.runBootstrapFunctions();
      // Freeze object.
      await this.freeze();
      // Init first start
      utils.init(this.config);

      this.app.use(this.router.routes()).use(this.router.allowedMethods());

      // Launch server.
      this.server.listen(this.config.port, async err => {
        if (err) return this.stopWithError(err);

        this.log.info('Time: ' + new Date());
        this.log.info(
          'Launched in: ' + (Date.now() - this.config.launchedAt) + ' ms'
        );
        this.log.info('Environment: ' + this.config.environment);
        this.log.info('Process PID: ' + process.pid);
        this.log.info(
          `Version: ${this.config.info.strapi} (node v${this.config.info.node})`
        );
        this.log.info('To shut down your server, press <CTRL> + C at any time');
        console.log();
        this.log.info(`☄️  Admin panel: ${this.config.admin.url}`);
        this.log.info(`⚡️ Server: ${this.config.url}`);
        console.log();

        // Emit started event.
        this.emit('server:started');

        if (cb && typeof cb === 'function') {
          cb();
        }

        if (
          (this.config.environment === 'development' &&
            _.get(
              this.config.currentEnvironment,
              'server.admin.autoOpen',
              true
            ) !== false) ||
          this.config.init
        ) {
          await utils.openBrowser.call(this);
        }
      });
    } catch (err) {
      this.stopWithError(err);
    }
  }

  /**
   * Add behaviors to the server
   */
  async enhancer() {
    // handle port in use cleanly
    this.server.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        return this.stopWithError(
          `The port ${err.port} is already used by another application.`
        );
      }

      this.log.error(err);
    });

    // Close current connections to fully destroy the server
    const connections = {};

    this.server.on('connection', conn => {
      const key = conn.remoteAddress + ':' + conn.remotePort;
      connections[key] = conn;

      conn.on('close', function() {
        delete connections[key];
      });
    });

    this.server.destroy = cb => {
      this.server.close(cb);

      for (let key in connections) {
        connections[key].destroy();
      }
    };
  }

  stopWithError(err) {
    this.log.debug(`⛔️ Server wasn't able to start properly.`);
    this.log.error(err);
    return this.stop();
  }

  stop() {
    // Destroy server and available connections.
    this.server.destroy();

    if (this.config.autoReload) {
      process.send('stop');
    }

    // Kill process.
    process.exit(1);
  }

  async load() {
    await this.enhancer();

    this.app.use(async (ctx, next) => {
      if (ctx.request.url === '/_health' && ctx.request.method === 'HEAD') {
        ctx.set('strapi', 'You are so French!');
        ctx.status = 204;
      } else {
        await next();
      }
    });

    const [
      config,
      api,
      admin,
      plugins,
      middlewares,
      hook,
      extensions,
      groups,
    ] = await Promise.all([
      loadConfig(this),
      loadApis(this),
      loadAdmin(this),
      loadPlugins(this),
      loadMiddlewares(this),
      loadHooks(this.config),
      loadExtensions(this.config),
      loadGroups(this),
    ]);

    _.merge(this.config, config);

    this.api = api;
    this.admin = admin;
    this.groups = groups;
    this.plugins = plugins;
    this.middleware = middlewares;
    this.hook = hook;

    /**
     * Handle plugin extensions
     */
    // merge extensions config folders
    _.mergeWith(this.plugins, extensions.merges, (objValue, srcValue, key) => {
      // concat routes
      if (_.isArray(srcValue) && _.isArray(objValue) && key === 'routes') {
        return srcValue.concat(objValue);
      }
    });
    // overwrite plugins with extensions overwrites
    extensions.overwrites.forEach(({ path, mod }) => {
      _.assign(_.get(this.plugins, path), mod);
    });

    // Populate AST with configurations.

    await bootstrap(this);

    // Usage.
    await utils.usage(this.config);

    // Init core store
    initCoreStore(this);

    this.db = await initializeDatabase(this);

    // Initialize hooks and middlewares.
    await initializeMiddlewares.call(this);
    await initializeHooks.call(this);
  }

  reload() {
    const state = {
      shouldReload: 0,
    };

    const reload = function() {
      if (state.shouldReload > 0) {
        // Reset the reloading state
        state.shouldReload -= 1;
        reload.isReloading = false;
        return;
      }

      if (this.config.autoReload) {
        this.server.close();
        process.send('reload');
      }
    };

    Object.defineProperty(reload, 'isWatching', {
      configurable: true,
      enumerable: true,
      set: value => {
        // Special state when the reloader is disabled temporarly (see GraphQL plugin example).
        if (state.isWatching === false && value === true) {
          state.shouldReload += 1;
        }
        state.isWatching = value;
      },
      get: () => {
        return state.isWatching;
      },
    });

    reload.isReloading = false;
    reload.isWatching = true;

    return reload;
  }

  async runBootstrapFunctions() {
    const timeoutMs = this.config.bootstrapTimeout || 3500;
    const warnOnTimeout = () =>
      setTimeout(() => {
        this.log.warn(
          `The bootstrap function is taking unusually long to execute (${timeoutMs} miliseconds).`
        );
        this.log.warn('Make sure you call it?');
      }, timeoutMs);

    async function execBootstrap(fn) {
      if (!fn) return;

      const timer = warnOnTimeout();
      try {
        await fn();
      } finally {
        clearTimeout(timer);
      }
    }

    const pluginBoostraps = Object.keys(this.plugins).map(plugin => {
      return execBootstrap(
        _.get(this.plugins[plugin], 'config.functions.bootstrap')
      ).catch(err => {
        strapi.log.error(`Bootstrap function in plugin "${plugin}" failed`);
        strapi.log.error(err);
        strapi.stop();
      });
    });

    await Promise.all(pluginBoostraps);

    return execBootstrap(_.get(this.config, ['functions', 'bootstrap']));
  }

  async freeze() {
    const propertiesToNotFreeze = this.propertiesToNotFreeze || [];

    // Remove object from tree.
    delete this.propertiesToNotFreeze;

    return Object.keys(this)
      .filter(x => !_.includes(propertiesToNotFreeze, x))
      .forEach(key => {
        Object.freeze(this[key]);
      });
  }

  getModel(modelKey, plugin) {
    return plugin === 'admin'
      ? _.get(strapi.admin, ['models', modelKey], undefined)
      : _.get(strapi.plugins, [plugin, 'models', modelKey]) ||
          _.get(strapi, ['models', modelKey]) ||
          _.get(strapi, ['groups', modelKey]) ||
          undefined;
  }

  /**
   * Binds queries with a specific model
   * @param {string} entity - entity name
   * @param {string} plugin - plugin name or null
   */
  query(entity, plugin) {
    return this.db.query(entity, plugin);
  }
}

module.exports = options => {
  const strapi = new Strapi(options);
  global.strapi = strapi;
  return strapi;
};
