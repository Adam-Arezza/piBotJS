const five = require('johnny-five')

//uses the pin numbers on the rpi header, not the GPIO numbers
const motors = new five.Motors([
    { pins: { dir: "P1-31", pwm: "P1-33" }, invertPWM:true },
    { pins: { dir: "P1-35", pwm: "P1-37" }, invertPWM:true }
])
const enable = new five.Pin({
    pin: "P1-7",
    type: "digital"
})

function turn(motors, direction, speed){
    if(direction == "right") {
        motors[0].forward(speed)
        motors[1].reverse(speed)
    }
    if(direction == "left") {
        motors[0].reverse(speed)
        motors[1].forward(speed)
    }
}
module.exports = {
    motors, enable, turn
}
