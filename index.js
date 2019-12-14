const five = require('johnny-five')
// const Raspi = require('raspi-io').RaspiIO
const express = require('express')
const app = express()
const http = require('http').createServer(app)
const io = require('socket.io')(http)

const rpi = require('pi-io')

const board = new five.Board({
    io: new rpi()
})

let distance = 0

board.on('ready', function () {
    console.log('Board is ready')
    const piMotors = require('./motors')
    const piArm = require('./arm')
    const proximity = new five.Proximity({
        controller: rpi.HCSR04, // Custom controller
        triggerPin: 'P1-11',
        echoPin: 'P1-16'
    })

    proximity.on('change', (data) => distance = data)

    io.on('connection', (socket) => {
        console.log("connection successful")
        socket.on("move", (dir) => {
            switch(dir) {
                case "forward":
                    piMotors.motors.forward(255)
                    break
                case "reverse":
                    piMotors.motors.reverse(255)
                    break
                default:
                    console.log("not moving")
            }
        })
        setInterval( function() {
            io.emit('distance', distance)
        }, 1000)
    })
    // setInterval( function() { console.log(distance)}, 1500)

    // this.repl.inject({
    //     piArm, piMotors
    // })
})

board.on('fail', function (event) {
    console.log(event)
})

http.listen(3000, ()=> console.log('listening on port 3000'))
