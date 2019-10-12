const five = require('johnny-five')
const Raspi = require('raspi-io').RaspiIO

const board = new five.Board({
    io: new Raspi()
})

board.on('ready', function() {
    console.log('Board is ready')
    const gripper = new five.Servo({
        pin:0,
        controller:"PCA9658",
        range:[50,150]
    })

    gripper.center()

    board.repl.inject({
        gripper
    })

})

board.on('fail', function(event) {
    console.log(event)
})