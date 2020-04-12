const five = require('johnny-five')
const cors = require('cors')
const express = require('express')
const app = express()
app.use(cors())
const http = require('http').createServer(app)
const io = require('socket.io')(http)
const rpi = require('pi-io')
const cv = require('opencv4nodejs')
const mpu = require('mpu9250')
const board = new five.Board({
    io: new rpi()
})

// const cam = new cv.VideoCapture(0)
// cam.set(cv.CAP_PROP_FRAME_WIDTH, 640)
// cam.set(cv.CAP_PROP_FRAME_HEIGHT, 480)
// const fps = 5

// setInterval(() => {
//     const frame = cam.read()
//     const img = cv.imencode('.jpg',frame).toString('base64')
//     io.emit('videoData', img)
// }, 1000/fps)

const piArm = require('./arm')
const arduino = 0x08
const imu = new mpu({ UpMagneto: true, scaleValues: true })
imu.initialize()

const LCD = new five.LCD({
    rows: 4,
    cols: 20,
    controller: "PCF8574T"
})

let welcome = () => {
    LCD.useChar("ascchart7")
    LCD.useChar("descchart5")
    LCD.cursor(0, 0).print("Hello, Greg")
    setTimeout(() => {
        LCD.clear()
        LCD.cursor(0, 4).print(":ascchart7:")
        LCD.cursor(0, 6).print(":ascchart7:")
        LCD.cursor(1, 3).print(":descchart5:")
        LCD.cursor(2, 4).print(":descchart5:")
        LCD.cursor(2, 5).print(":descchart5:")
        LCD.cursor(2, 6).print(":descchart5:")
        LCD.cursor(1, 7).print(":descchart5:")
    }, 2000)

}

let distance = (distData) => {
    board.io.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [1])
    board.io.i2cReadOnce(arduino, 3, (bytes) => {
        console.log(bytes)
    })
}

let motorCommand = (direction, speed) => {
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [direction, speed])
}



board.on('ready', function () {
    console.log('Board is ready')

    this.repl.inject({
        distance,
        LCD,
        imu,
        welcome
    })

    io.on('connection', (socket) => {
        console.log("connection successful")
        socket.on("move", (dir) => {
            switch (dir) {
                case "forward":
                    piMotors.enable.high()
                    piMotors.motors.forward(255)
                    break
                case "reverse":
                    piMotors.enable.high()
                    piMotors.motors.reverse(255)
                    break
                case "left":
                    piMotors.enable.high()
                    piMotors.turn(piMotors.motors, "left", 255)
                    break
                case "right":
                    piMotors.enable.high()
                    piMotors.turn(piMotors.motors, "right", 255)
                    break
                case "stop":
                    piMotors.enable.low()
                    piMotors.motors.stop()
                default:
                    console.log("not moving")
            }
        })
    })

})

http.listen(3000, () => console.log('listening on port 3000'))
