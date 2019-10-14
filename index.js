const five = require('johnny-five')
const Raspi = require('raspi-io').RaspiIO

const board = new five.Board({
    io: new Raspi()
})

function msg() {
    console.log("function from outside the board")
}

board.on('ready', function () {
    function turn(motors, direction, speed){
        if(direction == "left") {
            motors[0].forward(speed)
            motors[1].reverse(speed)
        }
        if(direction == "right") {
            motors[0].reverse(speed)
            motors[1].forward(speed)
        }
    }

    console.log('Board is ready')
    const gripper = new five.Servo({
        controller: "PCA9685",
        pin: 2,
        range: [10, 150]
    })
    const joint1 = new five.Servo({
        controller: "PCA9685",
        pin: 0,
        range: [30, 165]
    })
    const joint2 = new five.Servo({
        controller: "PCA9685",
        pin: 1,
        range: [30, 180]
    })
    const motors = new five.Motors([
        { pins: { dir: "P1-31", pwm: "P1-33" }, invertPWM:true },
        { pins: { dir: "P1-35", pwm: "P1-37" }, invertPWM:true }
    ])
    const enable = new five.Pin({
        pin: "P1-7",
        type: "digital"
    })
    // gripper.center()
    // joint1.center()
    // joint2.center()

    this.repl.inject({
        gripper, joint1, joint2, motors, turn, enable, msg
    })

})

board.on('fail', function (event) {
    console.log(event)
})