const { runEntrypoint, InstanceBase } = require('@companion-module/base');
const SmartJingleInstance = require('./src/main');

runEntrypoint(SmartJingleInstance, []);
