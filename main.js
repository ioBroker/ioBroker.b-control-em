/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var request =       require('request');
var cookieJar =     request.jar();
var meters =        [];
var meter_index =   0;
var numMeters;

var adapter = require(__dirname + '/../../lib/adapter.js')({

    name:           'b-control-em',

    ready: function () {
        getAuthCookie(getMeters);
    }

});

function getAuthCookie(callback) {
    adapter.log.info("login on " + adapter.config.host);
    request.get({
        url: 'http://' + adapter.config.host + '/index.php',
        jar: cookieJar
    }, function (err, res, body) {
        if (err) {
            adapter.log.error('auth failed');
            stop();
        } else {
            callback();
        }
    });
}

function getMeters(callback) {

    request.get({
        url: 'http://' + adapter.config.host + '/mum-webservice/meters.php',
        jar: cookieJar
    }, function (err, res, body) {
        var data = JSON.parse(body);
        data = data.meters;
        if (data.authentication == false) {
            adapter.log.error("auth failure");
            setTimeout(function () {
                getAuthCookie(getMeters);
            }, 60000);
            return;
        }
        adapter.log.info("found " + data.length + " sensors");
        numMeters = data.length;
        for (var i = 0; i < data.length; i++) {
            var obj = {
                type:       'state',
                common: {
                    name:   (data[i].label == "Teridian" ? 'Gesamtverbrauch' : data[i].label),
                    unit:   'W',
                    type:   'number',
                    role:   'value.power'
                },
                native: {
                    label:  data[i].label,
                    serial: data[i].serial,
                    model:  data[i].model,
                    type:   data[i].type
                }
            };
            adapter.log.info('add/update object ' + data[i].serial);
            adapter.setObject(data[i].serial, obj);
            meters[i] = data[i].serial;
        }
        startLoop();

    });
}

function startLoop() {
    if (++meter_index >= numMeters) meter_index = 0;
    getValue(meter_index, function () {
        setTimeout(startLoop, adapter.config.pause);
    });
}

function getValue(meter_id, callback) {
    request.post({

        jar: cookieJar,
        url: 'http://' + adapter.config.host + '/mum-webservice/consumption.php?meter_id=' + meter_id

    }, function (err, res, body) {

        var data = JSON.parse(body);
        if (data.authentication == false) {
            adapter.log.error("auth failure");
            getAuthCookie(getMeters);
            return;
        }

        var idx = ('0' + (meter_id + 1)).slice(-2);
        adapter.setState(meters[meter_id], parseFloat((data[idx + "_power"] * 1000).toFixed(1)))

        callback();

    });
}


function stop() {
    adapter.log.info("adapter b-control-em terminating");
    process.exit();
}

process.on('SIGINT', function () {
    stop();
});

process.on('SIGTERM', function () {
    stop();
});