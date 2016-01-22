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

export default {

  languageMap: {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  },

  reverseLanguageMap: {
    // 1: 'one',
    // 2: 'two',
    // 3: 'three',
    // 4: 'four',
    // 5: 'five',
    // 6: 'six',
    // 7: 'seven',
    // 8: 'eight',
    // 9: 'nine',
    // 10: 'ten'
  },

  units: {
    year: 365 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    minute: 60 * 1000,
    second: 1000
  },

  human: function (time) {
    if (!time) {
      return time;
    }
    if (typeof time === 'number') {
      return time;
    }
    time = this.swapLanguageToDecimals(time);
    time = time.replace(/(second|minute|hour|day|week|month|year)s?(?! ?(s )?and |s?$)/, '$1,');
    return time.split(/and|,/).reduce((sum, group) => {
      return sum + (group !== '' ? this.processUnits(group) : 0);
    }, 0);
  },

  machine: function (time) {
    let temp;
    let description = '';
    if (!time) {
      return time;
    }
    Object.keys(this.units).forEach((unitName) => {
      temp = this.collectUnit(time, this.units[unitName], unitName);
      description = description + temp[0] + (temp[0] === '' ? '' : ', ');
      time = temp[1]; // New time
    });
    description = description.slice(0, -2); // Removes the spurious comma-space
    return description;
  },

  collectUnit(time, unit, name) {
    /* Returns an array, the first element of which is a sentence
     * representing the units collected and the second element of
     * which is the time after collecting the unit.
     */
    let description;
    let newTime;
    const units = Math.floor(time / unit);
    if (units === 0) {
      description = '';
      newTime = time;
    } else {
      if (units > 10) {
        description = units;
      } else {
        description = this.reverseLanguageMap[units] || units;
      }
      description = description + ' ' + name + (units > 1 ? 's' : '');
      newTime = time - units * unit;
    }
    return [description, newTime];
  },

  swapLanguageToDecimals(time) {
    const language = this.languageMap;
    const languageMapRegex = new RegExp(`(${Object.keys(language).join('|')})`, 'g');
    const matches = time.match(languageMapRegex);

    if (!matches) {
      return time;
    }

    matches.forEach(function (match) {
      const matchStr = language[match] > 1 ? language[match] : language[match].toString().slice(1);
      time = time.replace(match, matchStr);
    });

    return time;
  },

  processUnits(time) {
    return (this.units[time.match(/(second|minute|hour|day|week|month|year)s?/)[1]] || 0) * (parseFloat(time) || 1);
  }
};

