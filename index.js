const five = require('johnny-five')
const cors = require('cors')
const express = require('express')
const app = express()
app.use(cors())
const http = require('http').createServer(app)
const io = require('socket.io')(http)
const rpi = require('pi-io')
const cv = require('opencv4nodejs')
const board = new five.Board({
    io: new rpi(),
    repl:false
})

const cam = new cv.VideoCapture(0)
const fps = 10

board.on('ready', function () {
    console.log('Board is ready')

    setInterval(() => {
        const frame = cam.read()
        const img = cv.imencode('.jpg',frame).toString('base64')
        io.emit('videoData', img)
    }, 1000/fps)
    // const piMotors = require('./motors')
    // const piArm = require('./arm')
    // const prox = require('./distance')

    io.on('connection', (socket) => {
        console.log("connection successful")
        // socket.on("move", (dir) => {
        //     switch(dir) {
        //         case "forward":
        //             piMotors.enable.high()
        //             piMotors.motors.forward(255)
        //             break
        //         case "reverse":
        //             piMotors.enable.high()
        //             piMotors.motors.reverse(255)
        //             break
        //         case "stop":
        //             piMotors.enable.low()
        //             piMotors.motors.stop()
        //         default:
        //             console.log("not moving")
        //     }
        // })
    })

})

board.on('fail', function (event) {
    console.log(event)
})

http.listen(3000, ()=> console.log('listening on port 3000'))
