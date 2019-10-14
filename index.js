const five = require('johnny-five')
const Raspi = require('raspi-io').RaspiIO
const piMotors = require('./motors')
const piArm = require('./arm')

const board = new five.Board({
    io: new Raspi()
})

function msg() {
    console.log("function from outside the board")
}

board.on('ready', function () {

    console.log('Board is ready')

    this.repl.inject({
        gripper, joint1, joint2, motors, turn, enable, msg
    })

})

board.on('fail', function (event) {
    console.log(event)
})