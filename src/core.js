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
import {each} from 'async';
import {inherits} from 'util';
import Promise from 'bluebird';
import {EventEmitter} from 'events';
import {after, mergeDeep, once, noop, isObject, isFunction, createLogger, requireModules} from './helpers';
import {hostname} from 'os';

class RediBox { // inherits EventEmitter doesn't quite work yet =/

  /**
   * Redis Caching Service
   * @param {Object} options Redis connection options
   * @param readyCallback
   * @returns {RediBox} Returns new instance of RediBox
   */
  constructor(options, readyCallback = noop) {
    if (isFunction(options)) {
      readyCallback = options;
      options = {};
    }

    // unique name of this instance, useful for targeted pubsub / ipc for modules
    // to communicate to other instances - i.e. pause a queue on all instances.
    this.id = hostname() + '.' + (Date.now() + Math.random().toString(36));

    // keep a timestamp of when we started
    this.boot_timestamp = Date.now();

    this.options = {
      logRedisErrors: false,
      redis: {
        prefix: 'rdb',
        publisher: true,
        subscriber: true,
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
      return callBackOnce(new Error('Failed to connect to redis, please check your config / servers.'));
    }, this.options.redis.connectionTimeout);

    // all clients callback here to notify ready state
    const reportReady = after(1 +
      (this.options.redis.cluster && this.options.redis.clusterScaleReads) +
      this.options.redis.publisher +
      this.options.redis.subscriber, once(() => {
      clearTimeout(connectFailedTimeout);
      this.log.verbose('Redis clients all reported as \'ready\'.');
      const clients = {
        client: this.client.status,
        client_read: this.options.redis.cluster && this.options.redis.clusterScaleReads ? this.client_read.status : null
      };
      this._loadModules(() => {
        this.log.verbose('-----------------------');
        this.log.verbose(' RediBox is now ready! ');
        this.log.verbose('-----------------------\n');
        this.emit('ready', clients);
        // set immediate to allow ioredis to init cluster.
        // without this cluster nodes are sometimes undefined
        return setImmediate(function () {
          callBackOnce(null, clients);
        });
      });
    }));

    // https://github.com/luin/ioredis#error-handling
    Redis.Promise.onPossiblyUnhandledRejection(this._redisError);

    if (this.options.redis.cluster) {
      this.log.verbose('Starting in cluster mode...');
      // check we have at least one host in the config.
      if (!this.options.redis.hosts && this.options.redis.hosts.length) {
        const noClusterHostsError = new Error(
          'No hosts found! When in cluster mode an array of hosts is required.'
        );
        this.emit('error', noClusterHostsError);
        return callBackOnce(noClusterHostsError);
      }
    }

    // normal read/write client
    this.createClient('client', reportReady);

    // create a second connection to use for scaled reads across
    // all cluster instances, masters & slaves.
    // UNLIMITED POWAAAHHHHH >=] https://media.giphy.com/media/hokMyu1PAKfJK/giphy.gif
    if (this.options.redis.cluster && this.options.redis.clusterScaleReads) {
      this.createClient('client_read', true, reportReady);
    }

    // client solely for subscribing
    if (this.options.redis.subscriber) {
      this.createClient('subscriber', ()=> {
        this.subscriberMessageEvents = new EventEmitter();
        this.subscriber.on('message', ::this._onMessage);
        this.subscriber.on('pmessage', ::this._onPatternMessage);
        reportReady();
      });
    }

    // client solely for publishing
    if (this.options.redis.publisher) {
      this.createClient('publisher', reportReady);
    }
  }

  /**
   * Internal error Handler - just emits all redis errors.
   * Also optionally logs them t console.
   * @private
   * @param {Error} error
   * @returns {null}
   */
  _redisError = (error) => {
    if (error) {
      if (this.options.logRedisErrors) this.log.error(error);
      this.emit('error', error);
    }
  };

  /**
   * Creates a new redis client, connects and then onto the core class
   * @private
   * @param clientName client name, this is also the property name on
   * @param readOnly
   * @param reportReady
   * @param scope
   */
  createClient(clientName:string, readOnly = false, reportReady = noop, scope = this) {
    if (isFunction(readOnly)) {
      reportReady = readOnly;
      readOnly = false;
    }
    if (this.options.redis.cluster) {
      this.log.verbose(`Creating a ${readOnly ? 'read only' : 'read/write'} redis CLUSTER client...`);
      scope[clientName] = new Redis.Cluster(this.options.redis.hosts, {readOnly: readOnly, ...this.options.redis});
      scope[clientName].readOnly = readOnly;
    } else {
      this.log.verbose(`Creating a ${readOnly ? 'read only' : 'read/write'} redis client...`);
      scope[clientName] = new Redis(this.options.redis);
    }

    scope[clientName].once('ready', () => {
      this.log.verbose(`${readOnly ? 'Read only' : 'Read/write'} redis client '${clientName}' is ready!`);
      return reportReady();
    });
  }

  /**
   * Module bootstrap,
   * @private
   * @param completed
   * @returns {*}
   */
  _loadModules(completed:Function) {
    this.log.verbose('Begin mounting modules...');
    requireModules({
      moduleLoader: (name, Module) => {
        this.log.verbose(`Mounting module '${name}'...`);
        const opts = this.options[name] || {};
        if (opts.enabled)
          Object.assign(this, {[name]: new Module(opts || {}, this)});
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
   * Attempts to serialize a json string into an object, else return
   * the original value.
   * @param message
   * @returns {string}
   * @private
   */
  _serializeSubMessage(message:string) {
    try {
      return JSON.parse(message);
    } catch (jsonError) {
      return message;
    }
  }

  /**
   * Internal pub/sub channel message listener
   * @param channel
   * @param message
   * @private
   */
  _onMessage(channel, message) {
    if (this.subscriberMessageEvents.listenerCount(channel) > 0) {
      setImmediate(() => {
        this.subscriberMessageEvents.emit(channel, {
          data: this._serializeSubMessage(message),
          channel: this.remKeyPrefix(channel),
          timestamp: Math.floor(Date.now() / 1000)
        });
      });
    }
  }

  /**
   * Internal pub/sub pattern message listener
   * @param pattern
   * @param channel
   * @param message
   * @private
   */
  _onPatternMessage(pattern, channel, message) {
    setImmediate(() => {
      if (this.subscriberMessageEvents.listenerCount(channel) > 0) {
        this.subscriberMessageEvents.emit(channel, {
          data: this._serializeSubMessage(message),
          channel: this.remKeyPrefix(channel),
          pattern,
          timestamp: Math.floor(Date.now() / 1000)
        });
      }
      if (pattern !== channel && this.subscriberMessageEvents.listenerCount(pattern) > 0) {
        this.subscriberMessageEvents.emit(pattern, {
          data: this._serializeSubMessage(message),
          channel: this.remKeyPrefix(channel),
          pattern,
          timestamp: Math.floor(Date.now() / 1000)
        });
      }
    });
  }

  /**
   * Unsubscribe after a subOnce has completed.
   * @param channel
   * @private
   */
  _unsubscribeAfterOnce(channel) {
    const channelWithPrefix = this.toKey(channel);
    setImmediate(()=> {
      this.log.verbose(`Checking to see if we should unsub from channel '${channelWithPrefix}'.`);
      this.getClient().pubsub('numsub', channelWithPrefix)
          .then((countSubs) => {
            this.log.verbose(`Channel '${channelWithPrefix}' subscriber count is ${countSubs[1]}.`);
            if (countSubs[1] <= 1) {
              this.log.verbose(`Unsubscribing from channel '${channelWithPrefix}'.`);
              // need the original non-prefix name here as unsub already adds it.
              this.unsubscribe(channel, null, this._redisError);
            }
          }).catch(this._redisError);
    });
  }

  /**
   * Subscribe to single or multiple channels / events and on receiving the first event
   * unsubscribe. Includes an optional timeout.
   * @param channels {string|Array}
   * @param listener
   * @param subscribed
   * @param timeout tim in ms until
   */
  subscribeOnce(channels, listener, subscribed, timeout) {
    const _channels = [].concat(channels); // no mapping here - need the original name
    each(_channels, (channel, subscribeOnceDone) => {
      let timedOut = false;
      let timeOutTimer;
      const channelWithPrefix = this.toKey(channel);

      if (timeout) {
        timedOut = false;
        timeOutTimer = setTimeout(() => {
          timedOut = true;
          this.subscriberMessageEvents.removeListener(channelWithPrefix, listener);
          this._unsubscribeAfterOnce(channel);
          listener({
            channel,
            timeout: true,
            timeoutPeriod: timeout,
            data: null,
            timestamp: Math.floor(Date.now() / 1000)
          });
        }, timeout);
      }

      this.subscriber.subscribe(channelWithPrefix, (subscribeError, count) => {
        if (subscribeError) return subscribeOnceDone(subscribeError, count);
        if (!timeout || !timedOut) {
          this.log.verbose(`Subscribed once to ${channelWithPrefix}`);
          this.subscriberMessageEvents.once(channelWithPrefix, (obj) => {
            if (!timeout || !timedOut) {
              clearTimeout(timeOutTimer);
              this._unsubscribeAfterOnce(channel);
              listener(obj);
            }
          });
        }
        subscribeOnceDone();
      });
    }, subscribed);
  }

  /**
   * Subscribe to all of the channels provided and as soon as the first
   * message is received from any channel then unsubscribe from all.
   * @param channels
   * @param listener
   * @param subscribed
   * @param timeout
   */
  subscribeOnceOf(channels, listener, subscribed, timeout) {
    let timeOutTimer = null;
    // create an internal listener to wrap around the provided listener
    // this will unsubscribe on the first event
    const _listener = once((message) => {
      if (timeOutTimer) clearTimeout(timeOutTimer);
      this.unsubscribe(channels, _listener, function () {
        listener(message);
      });
    });

    this.subscribe(channels, _listener, subscribed);

    if (timeout) {
      timeOutTimer = setTimeout(() => {
        _listener({
          timeout: true,
          timeoutPeriod: timeout,
          message: null,
          timestamp: Math.floor(Date.now() / 1000)
        });
      }, timeout + 50);
    }
  }

  /**
   * Subscribe to a redis channel(s)
   * @param channels {string|Array}
   * @param listener
   * @param subscribed
   */
  subscribe(channels, listener, subscribed = noop) {
    const _channels = [].concat(channels).map(this.toKey);
    this.subscriber.subscribe(..._channels, (subscribeError, count) => {
      if (subscribeError) return subscribed(subscribeError, count);
      each(_channels, (channel, subscribeDone) => {
        this.subscriberMessageEvents.on(channel, listener);
        return subscribeDone();
      }, subscribed);
    });
  }

  /**
   * Publish a message to all channels specified
   * @param channels {string|Array}
   * @param message
   * @param published
   */
  publish(channels, message, published = noop) {
    const _channels = [].concat(channels).map(this.toKey);
    const messageStringified = isObject(message) || Array.isArray(message) ? JSON.stringify(message) : message;
    each(_channels, (channel, publishedToChannel) => {
      this.publisher.publish(channel, messageStringified, publishedToChannel);
    }, published);
  }

  /**
   *
   * @param channels {string|Array}
   * @param listener
   * @param completed
   */
  unsubscribe(channels, listener, completed = noop) {
    const _channels = [].concat(channels).map(this.toKey);

    if (listener) {
      each(_channels, (channel, unsubscribed) => {
        this.subscriberMessageEvents.removeListener(channel, listener);
        return unsubscribed();
      }, noop);
    }

    this.subscriber.unsubscribe(..._channels, (err, count) => {
      if (err) return completed(err, count);
      this.log.verbose(`Unsubscribed from ${_channels.toString()}`);
      return completed();
    });
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
    if (this.subscriber) {
      this.subscriber.quit();
    }
    if (this.publisher) {
      this.publisher.quit();
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
    if (this.subscriber) {
      this.subscriber.disconnect();
    }
    if (this.publisher) {
      this.publisher.disconnect();
    }
  }

  /**
   * Send a command to all cluster master nodes - i.e. FLUSHALL
   * @param command
   * @param args
   * @returns {Promise}
   * @example
   *   RediBox.clusterExec('flushall').then(function (result) {
          console.dir(result);
        }, function (error) {
          console.dir(error);
        });
   */
  clusterExec(command:string, args = []) {
    if (!this.options.redis.cluster) {
      return Promise.reject(new Error('Cannot clusterExec: Not a cluster connection!'));
    }

    const nodes = Object.keys(this.client.masterNodes);

    if (!nodes.length) {
      return Promise.reject(new Error('Cannot clusterExec: No master nodes found!'));
    }

    return Promise.all(nodes.map(node => {
      return this.client.masterNodes[node][command.toLowerCase()].apply(this.client.masterNodes[node], args);
    }));
  }

  /**
   * Returns an array of all master and slave node addresses that
   * we have a redis connection to
   * @returns {Array}
   */
  clusterGetNodes() {
    if (!this.options.redis.cluster) {
      return [];
    }
    return Object.keys(this.client.nodes);
  }

  /**
   * Returns an array of all the slave node addresses.
   * @returns {Array}
   */
  clusterGetSlaves() {
    if (!this.options.redis.cluster) {
      return [];
    }
    const masters = this.clusterGetMasters();
    return Object.keys(this.client.nodes).filter(function (node) {
      return masters.indexOf(node) === -1;
    });
  }

  /**
   * Returns an array of all the master node addresses.
   * @returns {Array}
   */
  clusterGetMasters() {
    if (!this.options.redis.cluster) {
      return [];
    }
    return Object.keys(this.client.masterNodes);
  }

  /**
   * Returns the individual cluster node connection instance.
   *  - Returns 'false' if not found.
   * @param address
   * @returns {*}
   */
  clusterGetNodeClient(address:string) {
    if (!this.options.redis.cluster) {
      return false;
    }
    if (this.client.nodes.hasOwnProperty(address)) {
      return this.client.nodes[address];
    }
    return false;
  }

  /**
   * Makes sure we can actually use the cluster read client, otherwise use the master.
   *   - makes sure the read client is connected ok, if it's not then reverts to the
   *     standard non read only client.
   * @returns {boolean}
   */
  clusterCanScaleReads() {
    return this.options.redis.cluster && this.options.redis.clusterScaleReads && this.connectionOK(true);
  }

  /**
   * Returns a client for read only purposes.
   * @returns {*}
   */
  getReadOnlyClient() {
    if (this.clusterCanScaleReads()) {
      return this.client_read;
    }
    return this.client;
  }

  /**
   * Returns a client for read and write purposes.
   * Just a fluff function, can directly get `this.client`.
   * @returns {*}
   */
  getClient() {
    return this.client;
  }

  /**
   * Checks if a redis client connection is ready.
   * @returns {Boolean} Client status
   * TODO deprecate in favour of isClientConnected
   */
  connectionOK(readClient) {
    if (readClient) {
      return this.client_read.status === 'ready';
    }
    return this.client.status === 'ready';
  }

  /**
   * Checks if a redis client connection is ready.
   * @returns {Boolean} Client status
   */
  isClientConnected(client) {
    return client && client.status === 'ready';
  }

  /**
   * Returns if cluster or not.
   * @returns {boolean}
   */
  isCluster() {
    return this.options.redis.cluster;
  }

  /**
   * Defines a lua script as a command on both read and write clients if necessary
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
      if (this.client_read && !this.client_read.hasOwnProperty(key) &&
        script.hasOwnProperty('readOnly') &&
        script.readOnly === true) {
        this.log.verbose(`Defining ready only command for lua script '${key}' from module '${module}'.`);
        this.client_read.defineCommand(key, {numberOfKeys: script.keys, lua: script.lua});
      }
    });
  }

  // todo - allows custom lua commands to be called from the core RediBox class
  customCommandWrapper = (command, readOnly) => {
    const _this = this;
    return function () {
      'use strict';

      // most likely going to be non read only command
      const client = !readOnly ? _this.getClient() : _this.getReadOnlyClient();

      if (!_this.isClientConnected(client)) {
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

  /**
   * Appends the name spacing prefix onto the specified key name / pubsub channel name
   * @param key
   * @returns {string}
   */
  toKey = (key) => {
    return `${this.options.redis.prefix}:${key}`;
  };

  /**
   * Removes the internal name spacing key prefix
   * @param key
   * @returns {string}
   */
  remKeyPrefix = (key) => {
    return key.slice(this.options.redis.prefix.length + 1, key.length);
  };

}

inherits(RediBox, EventEmitter);
export default RediBox;


