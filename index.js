const five = require('johnny-five')
const Raspi = require('raspi-io').RaspiIO

const board = new five.Board({
    io: new Raspi()
})

board.on('ready', function() {
    console.log('Board is ready')
    const gripper = new five.Servo({
        controller:"PCA9685",
        pin:2,
        range:[50,150]
    })
    const joint1 = new five.Servo({
        controller: "PCA9685",
        pin:0,
        range:[30,150]
    })
    const joint2 = new five.Servo({
        controller:"PCA9685",
        pin:1,
        range:[30,150]
    })


    gripper.center()
    joint1.center()
    joint2.center()


    this.repl.inject({
        gripper, joint1, joint2
    })

})

board.on('fail', function(event) {
    console.log(event)
})