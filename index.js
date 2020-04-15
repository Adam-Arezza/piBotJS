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

//initialize video
const cam = new cv.VideoCapture(0)
cam.set(cv.CAP_PROP_FRAME_WIDTH, 640)
cam.set(cv.CAP_PROP_FRAME_HEIGHT, 480)
const fps = 5

//emits a video frame at fps times per second to the client
setInterval(() => {
    const frame = cam.read()
    const img = cv.imencode('.jpg',frame).toString('base64')
    io.emit('videoData', img)
}, 1000/fps)

//initalize the arm servos
const piArm = require("./arm")

//set the arduino i2c address
const arduino = 0x08

//initialize an mpu9250 object
const imu = new mpu({ UpMagneto: true, scaleValues: true })
imu.initialize()

//initialize a new LCD component
const LCD = new five.LCD({
    rows: 4,
    cols: 20,
    controller: "PCF8574T"
})

//displays a welcome message on the LCD
const welcome = () => {
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

//gets distance sensor data from the arduino
const distanceRead = (distData) => {
    board.io.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [1])
    board.io.i2cReadOnce(arduino, 3, (bytes) => {
        console.log(bytes)
    })
}

//sends motor commands to the arduino
const motorCommand = (direction, speed) => {
    //forward direction == 1
    //reverse direction == 2
    //speed 0 to 255
    let cmd = 2
    //need a function to determine left and right wheel speed and direction
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [cmd, direction, speed, direction, speed])
}

board.on('ready', function () {
    console.log('Board is ready')
    this.repl.inject({
        distanceRead,
        LCD,
        imu,
        welcome,
        motorCommand,
        piArm
    })

    io.on('connection', (socket) => {
        console.log("connection successful")
        socket.on("move", (dir) => {
            switch (dir) {
                case "forward":
                    motorCommand(1, 255)
                    break
                case "reverse":
                    motorCommand(2, 255)
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
                    motorCommand(1, 0)
                default:
                    console.log("not moving")
            }
        })
    })

})

http.listen(3000, () => console.log('listening on port 3000'))
