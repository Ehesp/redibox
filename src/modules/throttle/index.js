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

import {mergeDeep, nodify} from './../../helpers';

export default class Throttle {

  constructor(options, rdb) {
    this.rdb = rdb;
    this.options = {
      enabled: true,
      prefix: 'rdb:throttle'
    };
    mergeDeep(this.options, options);
    this.rdb.log.verbose(`${this.constructor.name} module has been mounted!`);
  }

  /**
   * Can an entity proceed with it's transaction? This will also subtract 1 from the
   * entities remaining limit and if still within limit it returns ok to proceed
   * You can route all your throttled 'things' through here.
   * @param entity
   * @param limit
   * @param time
   * @param callback
   * @returns {*}
   */
  proceed(entity, limit, time, callback) {
    return nodify(new Promise((resolve, reject)=> {
      resolve(this.enabled); // TODO
    }), callback);
  }

	/**
   * Returns the current limits for the specified entity
   * without costing a transaction.
   * @param entity
   * @param limit
   * @param time
   * @param callback
   * @returns {*}
	 */
  ready(entity, limit, time, callback) {
    return nodify(new Promise((resolve, reject)=> {
      resolve(this.enabled); // TODO
    }), callback);
  }

  /**
   * Increase the allowed transactions for the entities current time period
   * @param entity
   * @param amount
   */
  increment(entity, amount) {

  }

  /**
   * Lock down mode - setting to a state of `true` will reduce all limits by X percent
   * i.e if set to 90(%) and a entity originally had 10 a transaction limit
   * they would now only have 1 per duration until this was turned off.
   * Your virtual 'oh shit' button pretty much.
   * @param state
   * @param percent
   */
  lockDown(state, percent) {

  }

  /**
   * Clears all limits, keys and sanctions for the specified entity
   * @param entity
   * @param callback
   */
  reset(entity, callback) {
    // TODO
  }

  /**
   * Sanction an entity, i.e you breached the limit X time so now we'll punish
   * the entity and reject all transactions for X duration.
   * @param entity
   * @param duration
   * @param callback
   */
  sanction(entity, duration, callback) {
    return this.rdb.getClient().sanction(entity, duration, callback); // TODO LUA
  }

  /**
   * Absolve an entity - removes limit sanctions for the specified entity
   * @param entity
   * @param callback
   */
  absolve(entity, callback) {
    return this.rdb.getClient().absolve(entity, callback);  // TODO LUA
  }
}
