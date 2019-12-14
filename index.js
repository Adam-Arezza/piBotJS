const five = require('johnny-five')
// const Raspi = require('raspi-io').RaspiIO
const rpi = require('pi-io')

const board = new five.Board({
    io: new rpi()
})

let distance = 0

board.on('ready', function () {
    console.log('Board is ready')
    const piMotors = require('./motors')
    const piArm = require('./arm')
    const proximity = new five.Proximity({
        controller: rpi.HCSR04, // Custom controller
        triggerPin: 'P1-11',
        echoPin: 'P1-16'
    })

    proximity.on('change', (data) => distance = data)

    setInterval( function() { console.log(distance)}, 1500)

    this.repl.inject({
        piArm, piMotors
    })
})

board.on('fail', function (event) {
    console.log(event)
})