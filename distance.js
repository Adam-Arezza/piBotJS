const five = require('johnny-five')
const rpi = require('pi-io')

const proximity = new five.Proximity({
    controller: rpi.HCSR04, // Custom controller
    triggerPin: 'P1-11',
    echoPin: 'P1-16'
})

module.exports = {
    proximity
}