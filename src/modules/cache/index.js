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

import { deprecate } from 'util';
import { noop, isFunction, nodify, mergeDeep } from './../../helpers';

export default class Cache {

  constructor(options, rdb) {
    this.rdb = rdb;
    this.options = {
      enabled: true,
      defaultTTL: 6000,
      prefix: 'rdb:cache'
    };
    mergeDeep(this.options, options);
    this.rdb.log.verbose(`${this.constructor.name} module has been mounted!`);
  }

  /**
   * Converts the users key to the full redis key with module prefix.
   * @param key
   * @returns {string}
   */
  toKey(key) {
    return `${this.options.prefix}:${key || ''}`;
  }

  /**
   * To enable bypassing of cache for wrap functions
   * Toggles by default or pass in true/false
   * @param bool
   */
  bypass(bool) {
    this.options.enabled = bool || !this.options.enabled;
  }

  /**
   * Gets a cached item from redis.
   * @param {String} key Key
   * @param {function} callback Done Function
   * @param {boolean} masterOnly if in cluster mode and scaled reads are on, then setting this to true will
   *                  not use scaled reads for this request, as in, use the master servers only.
   * @return {*} No Returns
   */
  get(key, callback, masterOnly = false) {
    return nodify(new Promise((resolve, reject) => {
      const client = this.rdb.getReadOnlyClient(masterOnly);
      client
        .get(this.toKey(key))
        .then(function (value) {
          if (!value) {
            return resolve();
          }
          try {
            resolve(JSON.parse(value));
          } catch (e) {
            // key was most likely originally a primitive if it's erroring here
            resolve(value);
          }
        })
        .catch((getError) => {
          if (getError && client.readOnly) {
            // reading via slave caused an error, lets try the master client just once.
            return this.get(key, resolve, true); // todo callback/resolve issue here
          }
          if (getError) {
            this.redisError(getError);
            return reject(getError);
          }
        });
    }), callback);
  }

  /**
   * Create a new cached item.
   * @param {String} key Key
   * @param {String|Number|Object} val Value
   * @param {Number} ttl [Optional] Time to Live in seconds - defaults to global ttl
   * @param {Function} callback Done callback
   * @returns {*} No Returns.
   */
  set(key, val, ttl, callback = noop) {
    if (!this.rdb.connectionOK()) {
      return callback(new Error('Redis not connected or ready.'));
    }

    if (isFunction(ttl)) {
      callback = ttl;
      ttl = this.options.defaultTTL;
    }

    if (typeof val !== 'string') {
      try {
        val = JSON.stringify(val);
      } catch (e) {
        return callback(e);
      }
    }

    // this.client.setnxex(this.toKey(key), ttl || this.options.defaultTTL, val, (setnxexError, result) => {
    this.rdb
        .getClient()
        .set(this.toKey(key), val, 'NX', 'EX', ttl || this.options.defaultTTL, (setnxexError, result) => {
          if (setnxexError) {
            this.redisError(setnxexError);
            return callback(setnxexError);
          }
          return callback(null, result);
        });

    return this;
  }

  /**
   * Deletes a cached item.
   * @param {String} key Key
   * @param {Function} callback Done Callback
   * @returns {*} No Returns
   */
  del(key, callback = noop) {
    if (!this.rdb.connectionOK()) {
      return callback(new Error('Redis not connected or ready.'));
    }
    this.rdb
        .getClient()
        .del(this.toKey(key), callback);

    return this;
  }

  /**
   * Support our legacy apps (more for me really, sorry!)
   */
  wrap = deprecate(function () {
    'use strict';
    return this.wrapWaterline.apply(null, arguments);
  }, 'Cache.wrap is deprecated, please use a specific wrap function, i.e wrapWaterline or wrapPromise');

  /**
   * Cache wrap a sails waterline query.
   * @param {Object} waterlineQuery Waterline model before exec/then.
   * @param {Number} ttl key expiry time
   * @param {Boolean} keyOverride optional key override
   * @param {Boolean} skipCache whether to ignore cache and exec the waterlineQuery instead
   * @returns {Promise} ES6 Promise
   */
  wrapWaterline(waterlineQuery, ttl, keyOverride, skipCache) {
    return new Promise((resolve, reject) => {
      // I had to keep a scope reference, libs like sails
      // bind the promise therefore overriding arrow func binding :(
      const _this = this;
      const key = this.makeKeyFromQuery(waterlineQuery, keyOverride);
      const runQuery = function (getError, skipSet) {
        waterlineQuery.exec(function (waterlineError, result) {
          if (!Array.isArray(result) && result) {
            result = result.toObject();  // remove non essential sails bits
          }

          if (waterlineError) {
            return reject(waterlineError);
          }

          if (!getError && !skipSet) {
            // only try set the cache if the get was successful
            _this.set(key, result, ttl || _this.options.defaultTTL);
          }

          return resolve(result);
        });
      };

      if (skipCache || !this.options.enabled) {
        // just go straight to running the query
        return runQuery(null, true);
      }

      this.get(key, function (getError, value) {
        if (getError || !value) {
          return runQuery(getError);
        }
        // all good
        return resolve(value);
      });
    });
  }

  /**
   * Wraps a promise for the purposes of caching a successful result.
   * @param key
   * @param promise
   * @param ttl
   * @param skipCache
   * @returns {Promise}
   */
  wrapPromise(key, promise, ttl, skipCache) {
    return new Promise((resolve, reject) => {
      if (!key) {
        // got nothing to generate a key from with a promise, so always require one
        return reject(new Error('wrapPromise requires a cache key name.'));
      }

      // I had to keep a reference, libs like sails
      // bind the promise therefore overriding arrow func binding :(
      const _this = this;
      const execPromise = function (getError, skipSet) {
        promise.then(function (result) {
          if (!getError && !skipSet) {
            // only try set the cache if the get was successful
            _this.set(_this.toKey(key), result, ttl || _this.options.defaultTTL);
          }
          return resolve(result);
        }).catch(reject);
      };

      if (skipCache || !this.options.enabled) {
        return execPromise(null, true);
      }

      this.get(this.toKey(key), function (getError, value) {
        if (getError || !value) {
          return execPromise(getError);
        }
        // all good
        return resolve(value);
      });
    });
  }

  /**
   * Deletes all cached items or all items matching a cache key pattern.
   * @param {String} key Key
   * @param {Function} callback Done Callback
   * @returns {*} No Returns
   */
  clear(key, callback = noop) {
    if (!this.connectionOK()) {
      return callback(new Error('Redis not connected or ready.'));
    }

    if (isFunction(key)) {
      callback = key;
      key = '';
    }

    this.rdb
        .getClient()
        .keys(`${this.toKey(key)}*`, (keysError, data) => {
          if (keysError) {
            this.redisError(keysError);
            return callback(keysError);
          }

          let count = data.length;

          if (count === 0) {
            // nothing to delete
            return callback();
          }

          // todo multi del only if not in cluster mode
          data.forEach((keyItem) => {
            this.del(keyItem, (error) => {
              if (error) {
                count = 0;
                this.redisError(error);
                return callback(error);
              }
              if (count - 1 === 0) {
                callback(null, null);
              }
            });
          });
        });
  }

  /**
   * Returns a list of keys based on the provided key prefix.
   * @param {String} key Key prefix to search for.
   * @param {Function} callback Done Callback
   * @returns {*} No Returns
   */
  list(key, callback = noop) {
    if (!this.connectionOK()) {
      return callback(new Error('Redis not connected or ready.'), null);
    }

    if (isFunction(key)) {
      callback = key;
      key = '';
    }

    this.client.keys(`${this.toKey(key)}*`, (keysError, data) => {
      if (keysError) {
        this.redisError(keysError);
        return callback(keysError);
      }
      return callback(keysError, data);
    });
  }

  /**
   * Generates a key from a waterline query object. Basically stringifies the
   * sails _criteria object and removes non alphanumeric characters + white spaces
   * @param waterlineQuery
   * @param keyOverride
   * @returns {*}
   */
  makeKeyFromQuery(waterlineQuery, keyOverride) {
    if (keyOverride) {
      return keyOverride;
    }

    let modelName = '';
    const criteria = JSON
      .stringify(waterlineQuery._criteria)
      .replace(/\W+/g, '')
      .replace(/wherenull/g, '')
      .replace(/:/g, '');

    if (waterlineQuery && waterlineQuery._context &&
      waterlineQuery._context.adapter &&
      waterlineQuery._context.adapter.identity) {
      modelName = waterlineQuery._context.adapter.identity;
    }

    if (criteria && criteria !== '') {
      return `${modelName}:${criteria}`;
    }

    // had no criteria, mostly calling a find with no criteria
    // so reverts to just the model name as a key
    return `${modelName}`;
  }

  /**
   * Stringify an object to a pretty key name.  OOO PRETTTYYY
   * @param prefix
   * @param object
   * @returns {*}
   */
  makeKeyFromObject(prefix:string = '', object = {}) {
    const criteria = JSON
      .stringify(object)
      .replace(/\W+/g, '')
      .replace(/:/g, '');

    if (criteria && criteria !== '') {
      return `${prefix}:${criteria}`;
    }

    return `${prefix}`;
  }

}

