/**
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Salakar
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

import Redis from 'ioredis';
import {inherits} from 'util';
import {EventEmitter} from 'events';
import {after, mergeDeep, once, noop, isFunction, nodify, createLogger, requireModules} from './helpers';
import Cache from './modules/cache';

class RediBox {

  /**
   * Redis Caching Service
   * @param {Object} options Redis connection options
   * @param readyCallback
   * @returns {RediBox} Returns new instance of RediBox
   */
  constructor(options, readyCallback = noop) {
    if (!this instanceof RediBox) {
      return new RediBox(options, readyCallback);
    }

    if (isFunction(options)) {
      readyCallback = options;
      options = {};
    }

    this.options = {
      redis: {
        cluster: false,
        clusterScaleReads: true,
        connectionTimeout: 6000,
        host: '127.0.0.1',
        port: 6379,
        db: 0
      },
      log: {
        level: 'warn',
        label: 'RediBox',
        colorize: true,
        prettyPrint: true,
        humanReadableUnhandledException: true
      }
    };

    mergeDeep(this.options, options);

    // setup new logger
    this.log = createLogger(this.options.log);

    // because once is more than enough ;p
    const callBackOnce = once(readyCallback);

    // setup connection timeout
    const connectFailedTimeout = setTimeout(() => {
      return callBackOnce(new Error('Cache failed to connect to redis, please check your config / servers.'));
    }, this.options.redis.connectionTimeout);

    // all clients callback here to notify ready
    const reportReady = after(1 + (this.options.redis.cluster && this.options.redis.clusterScaleReads), once(() => {
      clearTimeout(connectFailedTimeout);
      this.log.verbose('Redis clients all reported as \'ready\'.');
      const clients = {
        client: this.client.status,
        client_read: this.options.redis.cluster ? this.client_read.status : null
      };
      this.loadModules(() => {
        this.log.verbose('-----------------------');
        this.log.verbose(' RediBox is now ready! ');
        this.log.verbose('-----------------------\n');
        this.emit('ready', clients);
        return callBackOnce(null, clients);
      });
    }));

    // https://github.com/luin/ioredis#error-handling
    Redis.Promise.onPossiblyUnhandledRejection(this.redisError);

    if (this.options.redis.cluster) {
      this.log.verbose('Starting in cluster mode...');
      // check we have at least one host in the config.
      if (!this.options.redis.hosts && this.options.redis.hosts.length) {
        const noClusterHostsError = new Error(
          'No hosts found, when in cluster mode an array of hosts is required.'
        );
        this.emit('error', noClusterHostsError);
        return callBackOnce(noClusterHostsError);
      }

      // create cluster master writes client
      this.log.verbose('Starting a redis read/write client...');
      this.client = new Redis.Cluster(this.options.redis.hosts, this.options.redis);

      if (this.options.redis.clusterScaleReads) {
        // create a second connection to use for scaled reads across
        // all cluster instances, masters & slaves.
        // UNLIMITED POWAAAHHHHH >=] https://media.giphy.com/media/hokMyu1PAKfJK/giphy.gif
        this.log.verbose('Starting a redis read only client...');
        this.client_read = new Redis.Cluster(this.options.redis.hosts, {readOnly: true, ...this.options.redis});
        this.client_read.readOnly = true;

        // sub to ready event
        this.client_read.once('ready', () => {
          this.log.verbose('Redis read only client reported \'ready\' status.');
          reportReady();
        });
      }
    } else {
      this.log.verbose('Starting a redis read/write client...');
      this.client = new Redis(this.options.redis);
    }
    // sub to ready event
    this.client.once('ready', () => {
      this.log.verbose('Redis read/write client reported \'ready\' status.');
      reportReady();
    });
  }

  /**
   * Internal error Handler - just emits all redis errors.
   * @param {Error} error
   * @returns {null}
   */
  redisError = (error) => {
    this.emit('error', error);
  };

  loadModules(completed) {
    this.log.verbose('Begin mounting modules...');
    requireModules({
      moduleLoader: (name, Module) => {
        this.log.verbose(`Mounting module '${name}'...`);
        Object.assign(this, {[name]: new Module(this.options[name] || {}, this)});
      },
      scriptLoader: (name, scripts) => {
        this.log.verbose(`Defining scripts for module '${name}'...`);
        this.defineLuaCommands(scripts, name);
      }
    });
    this.log.verbose('All modules mounted!\n');
    return completed();
  }

  /**
   * Force quit, will not wait for pending replies (use disconnect if you need to wait).
   * @returns null
   */
  quit() {
    if (this.client) {
      this.client.quit();
    }
    if (this.client_read) {
      this.client.quit();
    }
  }

  /**
   * Disconnects the redis clients but first waits for pending replies.
   */
  disconnect() {
    if (this.client) {
      this.client.disconnect();
    }
    if (this.client_read) {
      this.client.disconnect();
    }
  }

  /**
   * Returns a client for read only purposes.
   * @returns {*}
   */
  getReadOnlyClient() {
    if (this.canUseReadScaleClient()) {
      return this.client_read;
    }
    return this.client;
  }

  /**
   * Returns a client for read and write purposes.
   * @returns {*}
   */
  getClient() {
    return this.client;
  }

  /**
   * Checks if redis client connection is ready.
   * @returns {Boolean} Client status
   * // TODO deprecate in favour of isClientConnected
   */
  connectionOK(readClient) {
    if (readClient) {
      return this.client_read.status === 'ready';
    }
    return this.client.status === 'ready';
  }

  /**
   * Checks if redis client connection is ready.
   * @returns {Boolean} Client status
   */
  static isClientConnected(client) {
    return client && client.status === 'ready';
  }

  /**
   * Makes sure we can actually use the read client, otherwise use the master
   * @returns {boolean}
   */
  canUseReadScaleClient() {
    return this.options.redis.cluster && this.options.redis.clusterScaleReads && this.connectionOK(true);
  }

  /**
   *
   * @param name
   * @param lua
   * @param keys
   * @param readOnly
   */
  defineLuaCommand(name:string, lua:string, keys = 1, readOnly = false) {
    let clientsWithCommand = 0;
    const command = name.toLowerCase();

    // read/write instance
    if (!this.client.hasOwnProperty(command)) {
      this.client.defineCommand(command, {numberOfKeys: keys, lua: lua});
      if (!this.hasOwnProperty(command)) {
        this[command] = this.customCommandWrapper(command, readOnly);
      }
      clientsWithCommand = clientsWithCommand + 1;
    }

    // read only instance, if available and if the script is set as a ready only script
    if (this.client_read && !this.client_read.hasOwnProperty(command) && readOnly) {
      this.client_read.defineCommand(command, {numberOfKeys: keys, lua: lua});
      clientsWithCommand = clientsWithCommand + 1;
    }

    // return true/false if all possible clients got the command defined.
    return clientsWithCommand === (1 + (readOnly && this.options.redis.clusterScaleReads));
  }

  /**
   * Defines a lua command or commands on both clients;
   * @param customScripts
   * @param module*
   * @returns {*}
   */
  defineLuaCommands(customScripts, module = 'core') {
    Object.keys(customScripts).forEach((key) => {
      const script = customScripts[key];
      key = key.toLowerCase();
      // quick validations
      if (!script.hasOwnProperty('keys')) {
        return this.log.warn(`Script '${key}' from module '${module} is missing required property 'key'! ...SKIPPED!`);
      }

      if (!script.hasOwnProperty('lua')) {
        return this.log.warn(`Script '${key}' from module '${module} is missing required property 'lua'! ...SKIPPED!`);
      }

      // read/write instance
      if (!this.client.hasOwnProperty(key)) {
        this.log.verbose(`Defining command for lua script '${key}' from module '${module}'.`);
        this.client.defineCommand(key, {numberOfKeys: script.keys, lua: script.lua});
      }

      // read only instance, if available and if the script is set as a ready only script
      if (this.client_read && !this.client_read.hasOwnProperty(key) && script.hasOwnProperty('readOnly') && script.readOnly === true) {
        this.log.verbose(`Defining ready only command for lua script '${key}' from module '${module}'.`);
        this.client_read.defineCommand(key, {numberOfKeys: script.keys, lua: script.lua});
      }
    });
  }

  customCommandWrapper = (command, readOnly) => {
    const _this = this;
    return function () {
      'use strict';

      // most likely going to be non read only command
      const client = !readOnly ? _this.getClient() : _this.getReadOnlyClient();

      if (!RediBox.isClientConnected(client)) {
        return new Promise(function (resolve, reject) {
          return reject('Redis not connected or ready.');
        });
      }

      if (!client[command]) {
        return new Promise(function (resolve, reject) {
          return reject('Cannot find the specified command on any connected clients.');
        });
      }
      return client[command].apply(null, arguments);
    };
  };

}

inherits(RediBox, EventEmitter);
export default RediBox;


