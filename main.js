/* jshint -W097 */
// jshint strict:false
/*jslint node: true */
'use strict';

var request    = require('request');
var utils = require('@iobroker/adapter-core'); // Get common adapter utils
var cookieJar  = request.jar();
var meterIndex = 0;
var mid        = [];
var lang       = 'NameDe';
var tasks      = [];
var processed  = {};
var channelNames = {
    NameDe: 'Kanal',
    NameEn: 'Channel'
};
var timeout1, timeout2;

var adapter = utils.Adapter({
    name: 'b-control-em',
    ready: function () {
        adapter.getForeignObjects('system.config', function (err, obj) {
            if (obj && obj.common &&
                (obj.common.language === 'en' || obj.common.language === 'ru')) {
                lang = 'NameEn';
            }
            getAuthCookie(getMeters);
        });
    },
    unload: function (callback) {
        clearTimeout(timeout1);
        clearTimeout(timeout2);
    }
});

var obisDict = require(__dirname + '/lib/obisdictionary.json');

var mapping = {};
function getMapping () {
    var len = obisDict.length;

    for (var j = 0; j < len; j++) {
        mapping[obisDict[j].State] = obisDict[j];
    }
}
getMapping();

function getAuthCookie(callback) {
    adapter.log.debug('login on ' + adapter.config.host);
    adapter.setState('info.connection', false, true);

    request.get({
        url: 'http://' + adapter.config.host + '/index.php',
        jar: cookieJar
    }, function (err, res, body) {
        if (err) {
            adapter.log.error('auth failed');
            stop();
        } else {
            adapter.setState('info.connection', true, true);
            callback();
        }
    });
}

function processTasks() {
    if (tasks.length) {
        var task = tasks.pop();
        adapter.getObject(task._id, function (err, obj) {
            if (!obj) {
                adapter.setObject(task._id, task, function (err) {
                   setImmediate(processTasks);
                });
            } else {
                setImmediate(processTasks);
            }
        });
    }
}

function getMeters(callback) {

    request.get({
        url: 'http://' + adapter.config.host + '/mum-webservice/meters.php',
        jar: cookieJar
    }, function (err, res, body) {
        var sensor;
        try {
            sensor = JSON.parse(body);
        } catch (e) {
            adapter.log.error('Cannot parse answer meters list');
            stop();
            return;
        }
        sensor = sensor.meters;
        adapter.log.debug('found ' + sensor.length + ' channel');

        for (var i = 0; i < sensor.length; i++) {
            var obj = {
                type: 'state',
                common: {
                    name: sensor[i].label,
                    unit: 'W',
                    type: 'number',
                    role: 'value.power'
                },
                native: sensor[i]
            };
            sensor[i].label = sensor[i].label.replace(/[.\s]+/g, '_');
            obj._id = sensor[i].label;
            tasks.push(obj);

            mid.push({id: sensor[i].id, label: sensor[i].label});
        }
        processTasks();
        startLoop();
    });
}

function startLoop() {
    if (meterIndex >= mid.length) meterIndex = 0;

    getValue(meterIndex, function () {
        meterIndex++;
        clearTimeout(timeout1);
        timeout1 = setTimeout(startLoop, adapter.config.pause);
    });
}

function getValue(index, callback) {
    request.post({
        jar: cookieJar,
        url: 'http://' + adapter.config.host + '/mum-webservice/consumption.php?meter_id=' + mid[index].id
    }, function (err, res, body) {
        var sensor = JSON.parse(body);
        var start = false;
        if (sensor.authentication === false || sensor.authentication === 'false') {
            adapter.log.error('auth failure');
            clearTimeout(timeout2);
            timeout2 = setTimeout(getAuthCookie, 0, getMeters);
            return;
        }

        if (sensor.hasOwnProperty('registers')) {
            var numReg = sensor.registers.length;

            for (var i = 0; i < numReg; i++) {
                if (sensor.registers[i].register) {
                    var dict = mapping[sensor.registers[i].register];
                    if (!dict) {
                        if (!processed[mapping[sensor.registers[i].register]]) {
                            adapter.log.warn('No dictionary for "' + sensor.registers[i].register + '"');
                            processed[mapping[sensor.registers[i].register]] = true;
                        }
                        continue;
                    }

                    if (!processed[mid[index].label + '.' + dict[lang]]) {
                        processed[mid[index].label + '.' + dict[lang]] = true;

                        var obj = {
                            type: 'state',
                            common: {
                                name: dict[lang],
                                unit: dict.Unit,
                                type: 'number',
                                role: 'value.power'
                            },
                            native: {}
                        };
                        dict[lang] = dict[lang].replace(/[.\s]+/g, '_');
                        obj._id    = mid[index].label + '_' + channelNames[lang] + '.' + dict[lang];

                        if (!tasks.length) start = true;
                        tasks.push(obj);
                    }

                    adapter.setState(mid[index].label + '_' + channelNames[lang] + '.' + dict[lang], parseFloat(sensor.registers[i].value), true);
                }
            }
        } else {
            adapter.log.info('no Registers found');
        }

        // old version
        var idx;
        if (mid[index].id < 9) {
            idx = '0' + (mid[index].id + 1);
        } else {
            idx = (mid[index].id + 1);
        }
        adapter.setState(mid[index].label, parseFloat(sensor[idx + '_power'] * 1000), true);

        if (start) processTasks();

        callback();
    });
}


function stop() {
    adapter.setState('info.connection', false, true);
    adapter.log.info('adapter b-control-em terminating');
    process.exit();
}

process.on('SIGINT', function () {
    stop();
});

process.on('SIGTERM', function () {
    stop();
});
