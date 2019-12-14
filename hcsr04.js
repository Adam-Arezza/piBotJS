const five = require('johnny-five')

const proximity = new five.Proximity({
    controller: PiIO.HCSR04, // Custom controller
    triggerPin: 'P1-11',
    echoPin: 'P1-16'
})

module.exports = { proximity }
