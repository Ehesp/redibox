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

import {Logger, transports} from 'winston';
import {readdirSync, statSync} from 'fs';
import {createHash} from 'crypto';

export function sha1sum(data) {
  return createHash('sha1')
    .update(JSON.stringify(data))
    .digest('hex');
}

/**
 * Get the current unix timestamp
 * @param date
 * @returns {number}
 */
export function getTimeStamp(date) {
  return Math.floor((date || Date.now()) / 1000);
}

/**
 *
 * @param obj
 * @param path
 * @returns {*}
 */
export function deepGet(obj, path) {
  path.split('.').forEach(function (key) {
    if (!obj || !hasOwnProperty.call(obj, key)) {
      obj = null;
      return;
    }
    obj = obj[key];
  });
  return obj;
}

/**
 * @description Quick implementation of lodash's 'after' function
 * @param {number} n count
 * @param {Function} done  after count condition met callback
 * @returns {Function} After runner
 */
export function after(n, done) {
  return function () {
    n = n - 1;
    if (n === 0) return done();
  };
}

/**
 * Wrapper to only allow a function to run once
 * @param fn
 * @param context
 * @returns {Function}
 */
export function once(fn, context) {
  let result;
  return function () {
    if (fn) {
      result = fn.apply(context || this, arguments);
      fn = null;
    }
    return result;
  };
}

/**
 * Simple is function check
 * @param item
 * @returns {*|boolean}
 */
export function isFunction(item) {
  return (item && typeof item === 'function');
}

/**
 * Empty callback filler func.
 */
export function noop() {
}

/**
 * Allow promises or callbacks on native es6 promises - no prototyping because ew.
 * @param promise
 * @param callback
 * @returns {*}
 */
export function nodify(promise, callback) {
  if (callback) {
    // prevent any callback exceptions getting swallowed by the Promise handlers
    const queueThrow = function (e) {
      setTimeout(function () {
        throw e;
      }, 0);
    };
    promise.then(function (v) {
      try {
        callback(null, v);
      } catch (e) {
        queueThrow(e);
      }
    }).catch(function (r) {
      try {
        callback(r);
      } catch (e) {
        queueThrow(e);
      }
    });
  }
  return promise;
}

/**
 * Returns a new instance of winston logger with console transport only.
 * @param {Object} options logging level, defaults to warn
 * @returns {Logger} Winston Logger
 */
export function createLogger(options:Object) {
  return new Logger({
    transports: [
      new (transports.Console)(options)
    ]
  });
}

/**
 * Simple is object check.
 * @param item
 * @returns {boolean}
 */
export function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item) && item !== null);
}

/**
 * Deep merge two objects.
 * @param target
 * @param source
 */
export function mergeDeep(target, source) {
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, {[key]: {}});
        mergeDeep(target[key], source[key]);
      } else {
        Object.assign(target, {[key]: source[key]});
      }
    });
  }
  return target;
}

/**
 * Crude function to require all module folders in /modules.
 *  - Only runs once on startup.
 * TODO : cleanup/optimise
 * @param options
 */
export function requireModules(options) {
  const dirName = options.dirName || `${__dirname}/modules`;
  const moduleLoader = options.moduleLoader || noop;
  const scriptLoader = options.scriptLoader || noop;
  readdirSync(dirName).sort().reverse().forEach(function (file) {
    const filePath = dirName + '/' + file;
    if (statSync(filePath).isDirectory() && !filePath.match(/lib\/modules\/.+\/.+\//)) {
      requireModules({
        dirName: filePath,
        moduleLoader,
        scriptLoader
      });
    } else {
      const matchModule = filePath.match(/\/([a-zA-Z]+)\/index\.js$/);
      const matchScripts = filePath.match(/\/([a-zA-Z]+)\/scripts\.js$/);
      if (matchModule) {
        moduleLoader(matchModule[1], require(filePath).default);
      }
      if (matchScripts) {
        scriptLoader(matchScripts[1], require(filePath).default);
      }
    }
  });
}
