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
require('sylvester')
const inquirer = require('inquirer')
const board = new five.Board({
    io: new rpi(),
    repl: false
})


// //initialize video
// const cam = new cv.VideoCapture(0)
// cam.set(cv.CAP_PROP_FRAME_WIDTH, 640)
// cam.set(cv.CAP_PROP_FRAME_HEIGHT, 480)
// const fps = 5

// //emits a video frame at fps times per second to the client
// setInterval(() => {
//     const frame = cam.read()
//     const img = cv.imencode('.jpg', frame).toString('base64')
//     io.emit('videoData', img)
// }, 1000 / fps)

const KP = 20
const KI = 0.8
const KD = 0
let xGoal = 0
let yGoal = 0
let headingAngle
const l = 0.025
let count = 0
let reFresh

const robotData = {
    deltaTL: 0,
    deltaTR: 0,
    leftTickTotal: 0,
    rightTickTotal: 0,
    posX: 0,
    posY: 0,
    heading: 0,
    headingErr: 0,
    sumErr: 0,
    ultrasonicArray: [0, 0, 0],
    imu: [],
    wheelBase: 0.2286,
    wheelRadius: 0.030,
    rightRPM: 0,
    leftRPM: 0
}

//initalize the arm servos
// const piArm = require("./arm")

//set the arduino i2c address
const arduino = 0x08

//initialize an mpu9250 object
// const imu = new mpu({ UpMagneto: true, scaleValues: true })
// imu.initialize()

//initialize a new LCD component
// const LCD = new five.LCD({
//     rows: 4,
//     cols: 20,
//     controller: "PCF8574T"
// })

//displays a welcome message on the LCD
// function welcome() {
//     LCD.useChar("ascchart7")
//     LCD.useChar("descchart5")
//     LCD.cursor(0, 0).print("Hello, Greg")
//     setTimeout(() => {
//         LCD.clear()
//         LCD.cursor(0, 4).print(":ascchart7:")
//         LCD.cursor(0, 6).print(":ascchart7:")
//         LCD.cursor(1, 3).print(":descchart5:")
//         LCD.cursor(2, 4).print(":descchart5:")
//         LCD.cursor(2, 5).print(":descchart5:")
//         LCD.cursor(2, 6).print(":descchart5:")
//         LCD.cursor(1, 7).print(":descchart5:")
//     }, 2000)
// }

//get goal coordinates from the user
function getGoal() {
    return new Promise((resolve, reject) => {
        inquirer.prompt([
            {
                type: 'number',
                name: 'x',
                message: "x?"
            },
            {
                type: 'number',
                name: 'y',
                message: "y?"
            }
        ])
            .then((answers) => {
                xGoal = answers.x
                yGoal = answers.y
                headingAngle = Math.atan2(yGoal, xGoal)
                resolve("success")
            })
            .catch((err) => {
                console.log(err)
                reject("No coordinates")
            })
    })
}

//gets distance sensor + encoder data from the arduino
function getAllData() {
    try {
        // console.log("Gathering data...")
        board.io.i2cConfig({
            address: arduino
        })
        board.io.i2cReadOnce(arduino, 10, (bytes) => {
            //bytes[2], [3], [4], [5] == left encoder
            //bytes[6], [7], [8], [9] == right encoder
            robotData.ultrasonicArray = [bytes[0], bytes[1]]
            let leftEncoder = Buffer.from([bytes[2], bytes[3], bytes[4], bytes[5]])
            let leftTick = Number(leftEncoder.readInt32BE(0).toString())
            let rightEncoder = Buffer.from([bytes[6], bytes[7], bytes[8], bytes[9]])
            let rightTick = Number(rightEncoder.readInt32BE(0).toString())
            robotData.deltaTL = Number((leftTick - robotData.leftTickTotal).toFixed(3))
            robotData.deltaTR = Number((rightTick - robotData.rightTickTotal).toFixed(3))
            robotData.leftTickTotal = leftTick
            robotData.rightTickTotal = rightTick
        })
        // robotData.imu = imu1.getMotion9()
        getNewPos()
    }
    catch (err) {
        console.log(err)
    }

}

function getNewPos() {
    // console.log("calculating new position")
    let dr = 2 * Math.PI * robotData.wheelRadius * (robotData.deltaTR / 40)
    let dl = 2 * Math.PI * robotData.wheelRadius * (robotData.deltaTL / 40)
    let dc = (dl + dr) / 2
    let rightRadPerSec = (dr / 0.1) / robotData.wheelRadius
    let leftRadPerSec = (dl / 0.1) / robotData.wheelRadius
    robotData.rightRPM = (rightRadPerSec / (2 * Math.PI)) * 60
    robotData.leftRPM = (leftRadPerSec / (2 * Math.PI)) * 60
    //Calculate robot heading
    robotData.heading = Number((robotData.heading + ((dr - dl) / robotData.wheelBase)).toFixed(3))
    robotData.posX = Number((robotData.posX + dc * Math.cos(robotData.heading)).toFixed(3))
    robotData.posY = Number((robotData.posY + dc * Math.sin(robotData.heading)).toFixed(3))

    //add a correction factor for heading using IMU
    goToGoal()
}

function goToGoal() {
    // console.log("heading to goal")
    let u1 = Math.abs(xGoal - robotData.posX)
    let u2 = Math.abs(yGoal - robotData.posY)
    // let u1 = (xGoal - robotData.posX)
    // let u2 = (yGoal - robotData.posY)
    // if(Number(u1.toFixed(3)) < 0.03 ) {
    //     u1 = 0
    // }
    // if(Number(u2.toFixed(3)) < 0.03) {
    //     u2 = 0
    // }
    if(Math.abs(robotData.posX) > Math.abs(xGoal)) {
        u1 = 0
    }
    if(Math.abs(robotData.posY) > Math.abs(yGoal)) {
        u2 = 0
    }
    u1 = Number(u1.toFixed(3))
    u2 = Number(u2.toFixed(3))
    let errors = [u1, u2]
    controller(errors)
}

function controller(e) {
    // console.log("Computing controller outputs")
    let oldErr = robotData.headingErr
    robotData.headingErr = Number((headingAngle - robotData.heading).toFixed(3))
    let deltaErr = robotData.headingErr - oldErr
    robotData.sumErr = Number((robotData.sumErr + robotData.headingErr).toFixed(3))
    let pidOut = KP * robotData.headingErr + KI * robotData.sumErr + KD * deltaErr
    // console.log(oldErr, headingAngle, robotData.heading, robotData.headingErr, robotData.sumErr, deltaErr)
    let hErr = Number(robotData.headingErr.toFixed(2))
    let xErr = Number(e[0].toFixed(3))
    let yErr = Number(e[1].toFixed(3))

    if (hErr < 0.05 && xErr < 0.05 && yErr < 0.05 && count != 0) {
        motorCommand(0, 0)
        clearInterval(reFresh)
        setTimeout(resetArduino, 200)
        console.log(`Moved to x: ${xGoal} y: ${yGoal}`)
        resetRobotData()
        return updater()
    }
    mapVals(pidOut, e)
}

function mapVals(outPut, u) {
    // console.log("Determining translational and angular velocities")
    let v = Math.abs(Math.sqrt((u[0] * u[0]) + (u[1] * u[1])))
    v = Number(v.toFixed(3))
    // console.log(`Translation: ${v}  Rad/s: ${outPut}`)
    let vr = Math.round((2 * v + outPut * robotData.wheelBase) / (2 * robotData.wheelRadius))
    let vl = Math.round((2 * v - outPut * robotData.wheelBase) / (2 * robotData.wheelRadius))
    // console.log(vr, vl)
    console.log(robotData.headingErr, robotData.heading, robotData.posX, robotData.posY, robotData.leftTickTotal, robotData.rightTickTotal, v, u, vl, vr)
    // console.log(robotData.headingErr, u, robotData.leftTickTotal, robotData.rightTickTotal, robotData.leftRPM, robotData.rightRPM)
    motorCommand(vr, vl)
}

//sends motor commands to the arduino
function motorCommand(vr, vl) {
    //forward direction == 1
    //reverse direction == 2
    //speed 5 to 35 = 200 to 255
    // console.log(vr, vl)
    const vMax = 255
    const vMin = 200
    let spdL
    let spdR
    const dirL = 1
    const dirR = 1
    const upperThresh = 35
    const lowerThresh = 5
    const threshRange = upperThresh - lowerThresh
    const maxRange = vMax - vMin
    // vr = vr * 1.25
    if (vr < 0) {
        vr = 0
        // dirR = 2
    }
    if (vl < 0) {
        vl = 0
        // dirL = 2
    }

    if (vr > upperThresh) {
        spdR = vMax
    }

    if (vr > 0 && vr < lowerThresh) {
        spdR = vMin
    }

    if (vr >= lowerThresh && vr <= upperThresh) {
        spdR = (((vr - lowerThresh) * maxRange) / threshRange) + vMin
    }

    if (vl > upperThresh) {
        spdL = vMax
    }

    if (vl > 0 && vl < lowerThresh) {
        spdL = vMin
    }

    if (vl >= lowerThresh && vl <= upperThresh) {
        spdL = (((vl - lowerThresh) * maxRange) / threshRange) + vMin
    }
    if (vl == 0) {
        spdL = 0
    }
    if (vr == 0) {
        spdR = 0
    }

    let cmd = 2
    spdL = Math.round(spdL)
    spdR = Math.round(spdR)
    // console.log(spdL, spdR, vr, vl)
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [cmd, dirL, spdL, dirR, spdR])
    if (count < 3) {
        count++
    }
}

function resetArduino() {
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [3])
}

function resetRobotData() {
    let keys = Object.keys(robotData)
    keys.forEach(key => {
        if (key != "ultrasonicArray" && key != "imu" && key != "wheelBase" && key != "wheelRadius") {
            robotData[key] = 0
        }
    })
    return console.log("Robot reset")
}

const updater = async () => {
    let start = await getGoal()
    if (start) {
        reFresh = setInterval(getAllData, 50)
    }
}


board.on('ready', function () {
    console.log('Board is ready')
    // this.repl.inject({
    //     LCD,
    //     welcome,
    //     motorCommand,
    //     // piArm,
    // })

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
    updater()
})

// board.on("exit", function() {
//     motorCommand(1, 0, 1, 0)
//     clearInterval(updater)
// })

// board.on("close", function() {
//     motorCommand(1, 0, 1, 0)
//     clearInterval(updater)
// })

http.listen(3000, () => console.log('listening on port 3000'))
