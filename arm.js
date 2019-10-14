const five = require('johnny-five')
const controller = "PCA9685"

const gripper = new five.Servo({
    controller: controller,
    pin: 2,
    range: [10, 150]
})
const joint1 = new five.Servo({
    controller: controller,
    pin: 0,
    range: [30, 165]
})
const joint2 = new five.Servo({
    controller: controller,
    pin: 1,
    range: [30, 180]
})

module.exports = {
    gripper, joint1, joint2
}