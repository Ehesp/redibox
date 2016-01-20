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

import {mergeDeep} from './../../helpers';

export default class IPC {

  constructor(options, rdb) {
    this.rdb = rdb;
    this.options = {
      enabled: true
    };
    mergeDeep(this.options, options);
    this.rdb.log.verbose(`${this.constructor.name} module has been mounted!`);
  }

  /**
   * Generates a random id using math.random.
   * Due to the extremely low message time to live the
   * chances of collision using this are slim. So no
   * need for a hash generator.
   *
   * Example id format:
   *      ```14533077294510.7k3b7vz83ktep14i```
   *
   * @returns {string}
   */
  generateMessageId() {
    return (Date.now() + Math.random().toString(36));
  }

}

