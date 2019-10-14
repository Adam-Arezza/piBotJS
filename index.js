const five = require('johnny-five')
const Raspi = require('raspi-io').RaspiIO

const board = new five.Board({
    io: new Raspi()
})

board.on('ready', function () {
    console.log('Board is ready')
    const piMotors = require('./motors')
    const piArm = require('./arm')

    this.repl.inject({
        piArm, piMotors
    })
})

board.on('fail', function (event) {
    console.log(event)
})