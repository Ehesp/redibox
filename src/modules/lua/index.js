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

import defaultScripts from './scripts';
import { isObject } from './../../helpers';

/**
 * Using the built in ioredis commander to generate methods from the lua scripts
 * @param client
 * @param customScripts
 * @returns {*}
 */
export function defineLuaCommands(client, customScripts) {
  const scripts = isObject(customScripts) ? Object.assign(defaultScripts, customScripts) : defaultScripts;
  return new Promise(function (resolve) {
    Object.keys(scripts).forEach(function (key) {
      const script = scripts[key];
      key = key.toLowerCase();
      // quick validations
      if (!script.hasOwnProperty('keys')) return; // todo log warning that script was not loaded
      if (!script.hasOwnProperty('lua') || !script.lua.length) return; // todo log warning that script was not loaded

      // define new script only if no already existing
      if (!client.hasOwnProperty(key)) {
        client.defineCommand(key, {numberOfKeys: script.keys, lua: script.lua});
      }
    });
    return resolve(scripts);
  });
}

