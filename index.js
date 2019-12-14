const five = require('johnny-five')
// const Raspi = require('raspi-io').RaspiIO
const rpi = require('pi-io')

const board = new five.Board({
    io: new PiIO()
})

board.on('ready', function () {
    console.log('Board is ready')
    // const piMotors = require('./motors')
    // const piArm = require('./arm')
    const piDistance = require('./hcsr04')

    piDistance.on('change', (data) => console.log(data))

    // this.repl.inject({
    //     piArm, piMotors
    // })
})

board.on('fail', function (event) {
    console.log(event)
})