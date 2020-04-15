const five = require('johnny-five')
const controller = "PCA9685"

const gripper = new five.Servo({
    controller: controller,
    pin: 2,
    range: [90, 180]
})

const joint1 = new five.Servo({
    controller: controller,
    pin: 0,
    range: [30, 165]
})

const joint2 = new five.Servo({
    controller: controller,
    pin: 1,
    isInverted: true,
    range: [10, 180]
})

const camera = new five.Servo({
    controller: controller,
    pin: 3,
    range: [40, 110]
})

module.exports = {
    gripper, joint1, joint2, camera
}