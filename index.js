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

const KP = 40
const KI = 0.1
const KD = 0
let xGoal = 0
let yGoal = 0
let headingAngle
let count = 0
let reFresh
let dt = 0.05
let goals = []
let completed = []
const gryoOffsets = {
    x: 1.342473282,
    y: -1.471261069,
    z: 1.35940458
}

//robot object holds parameters of the robot
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
const imu = new mpu({ UpMagneto: true, scaleValues: true, gyroBiasOffset: gryoOffsets })
imu.initialize()

//initialize a new LCD component
const LCD = new five.LCD({
    rows: 4,
    cols: 20,
    controller: "PCF8574T"
})

//get goal coordinates from the user
function getGoal() {
    return new Promise((resolve, reject) => {
        inquirer.prompt([
            {
                type: 'input',
                name: 'x1',
                message: "x1?"
            },
            {
                type: 'input',
                name: 'y1',
                message: "y1?"
            },
            {
                type: 'input',
                name: 'x2',
                message: 'x2?'
            },
            {
                type: 'input',
                name: 'y2',
                message: 'y2?'
            },
            {
                type: 'input',
                name: 'x3',
                message: 'x3?'
            },
            {
                type: 'input',
                name: 'y3',
                message: 'y3?'
            }
        ])
            .then((answers) => {
                goals.push([Number(answers.x1), Number(answers.y1)], [Number(answers.x2), Number(answers.y2)], [Number(answers.x3), Number(answers.y3)])
                xGoal = Number(answers.x1)
                yGoal = Number(answers.y1)
                if (isNaN(xGoal) || isNaN(yGoal)) {
                    throw new Error("coordinates must be numeric values")
                }
                headingAngle = Math.atan2(yGoal, xGoal)
                resolve("success")
            })
            .catch((err) => {
                console.log(err)
                reject("No coordinates")
                updater()
            })
    })
}

//calculates the new heading goal based on the last 2 vectors
function getNewHeadingGoal(v1, v2) {
    let dotProd = v1[0] * v2[0] + v1[1] * v2[1]
    // console.log(dotProd)
    let v1Mag = Math.sqrt(Math.pow(v1[0], 2) + Math.pow(v1[1], 2))
    // console.log(v1Mag)
    let v2Mag = Math.sqrt(Math.pow(v2[0], 2) + Math.pow(v2[1], 2))
    // console.log(v2Mag)
    let newHeading = headingAngle + Math.acos((dotProd) / (v1Mag * v2Mag))
    return newHeading
}

//gets distance sensor + encoder data from the arduino
//gets imu data
//sets robotData values
function getAllData() {
    robotData.imu = imu.getGyro()
    try {
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
            let tpsR = robotData.rightRPM / (60 * 40)
            let tpsL = robotData.leftRPM / (60 * 40)
            let ticksR = Math.round(tpsR * dt)
            let ticksL = Math.round(tpsL * dt)
            if (robotData.deltaTL > ticksL + 15) {
                robotData.leftTickTotal = robotData.leftTickTotal + ticksL
                robotData.deltaTL = ticksL
            }
            else if (leftTick < 0) {
                robotData.leftTickTotal = robotData.leftTickTotal + ticksL
                robotData.deltaTL = ticksL
            }
            else {
                robotData.leftTickTotal = leftTick
            }
            if (robotData.deltaTR > tpsR + 15) {
                robotData.rightTickTotal = robotData.rightTickTotal + ticksR
                robotData.deltaTR = ticksR
            }
            else if (rightTick < 0) {
                robotData.rightTickTotal = robotData.rightTickTotal + ticksR
                robotData.deltaTR = ticksR
            }
            else {
                robotData.rightTickTotal = rightTick
            }
            // robotData.leftTickTotal = leftTick
            // robotData.rightTickTotal = rightTick
            // console.log(leftTick, rightTick)
        })
        getNewPos()
    }
    catch (err) {
        console.log("---------------------------------------------------------------------")
        console.log(err)
        let tpsR = robotData.rightRPM / (60 * 40)
        let tpsL = robotData.leftRPM / (60 * 40)
        let ticksR = Math.round(tpsR * dt)
        let ticksL = Math.round(tpsL * dt)
        robotData.leftTickTotal = robotData.leftTickTotal + ticksL
        robotData.rightTickTotal = robotData.rightTickTotal + ticksR
        robotData.deltaTL = ticksL
        robotData.deltaTR = ticksR
        motorCommand(0, 0)
        handleCommsErr()
    }
}

//updates the LCD screen with the x, y, and heading position of the robot 
function updateLCD() {
    try {
        LCD.cursor(0, 0).print(`x position: `)
        LCD.cursor(0, 13).print(robotData.posX.toString())
        LCD.cursor(1, 0).print(`y position: `)
        LCD.cursor(1, 13).print(robotData.posY.toString())
        LCD.cursor(2, 0).print(`heading: `)
        LCD.cursor(2, 9).print(robotData.heading.toString())
    }
    catch (err) {
        console.log("-------------LCD ERROR-------------------")
    }
}

//calculates the robots current position
function getNewPos() {
    let dr = 2 * Math.PI * robotData.wheelRadius * (robotData.deltaTR / 40)
    let dl = 2 * Math.PI * robotData.wheelRadius * (robotData.deltaTL / 40)
    dr = Number(dr.toFixed(4))
    dl = Number(dl.toFixed(4))
    let dc = (dl + dr) / 2
    let rightRadPerSec = (dr / dt) / robotData.wheelRadius
    let leftRadPerSec = (dl / dt) / robotData.wheelRadius
    robotData.rightRPM = (rightRadPerSec / (2 * Math.PI)) * 60
    robotData.leftRPM = (leftRadPerSec / (2 * Math.PI)) * 60
    //Calculate robot heading
    let headingEncoders = Number((robotData.heading + ((dr - dl) / robotData.wheelBase)).toFixed(3))
    let headingImu = Number((robotData.heading + robotData.imu[2] * 0.0174533 * dt).toFixed(4))
    if (headingEncoders > headingImu) {
        robotData.heading = (0.3 * headingEncoders + 0.7 * headingImu)
    }
    else {
        robotData.heading = (0.5 * headingEncoders + 0.5 * headingImu)
    }
    robotData.posX = Number((robotData.posX + dc * Math.cos(robotData.heading)).toFixed(3))
    robotData.posY = Number((robotData.posY + dc * Math.sin(robotData.heading)).toFixed(3))
    //add a correction factor for heading using IMU
    // console.log(headingImu, headingEncoders, robotData.heading)
    // console.log(robotData.imu)
    goToGoal()
}

//calculates the x and y errors
//checks if the robot has reach its goal
function goToGoal() {
    let u1 = Math.abs(xGoal - robotData.posX)
    let u2 = Math.abs(yGoal - robotData.posY)
    if (Math.abs(robotData.posX) > Math.abs(xGoal)) {
        u1 = 0
    }
    if (Math.abs(robotData.posY) > Math.abs(yGoal)) {
        u2 = 0
    }
    u1 = Number(u1.toFixed(3))
    u2 = Number(u2.toFixed(3))
    let hErr = Number(robotData.headingErr.toFixed(2))
    if (hErr < 0.03 && u1 < 0.03 && u2 < 0.03 && count != 0) {
        goals.shift()
        console.log("goal 1 complete")
        console.log(goals.length)
        completed.unshift([xGoal, yGoal])
        if (goals.length > 0) {
            let v1
            if(completed.length == 1) {
                v1 = [xGoal, yGoal]
            }
            if(completed.length > 1) {
                v1 = [completed[0][0] - completed[1][0], completed[0][1] - completed[1][1]]
            }
            xGoal = goals[0][0]
            yGoal = goals[0][1]
            let deltaX = xGoal - robotData.posX
            let deltaY = yGoal - robotData.posY
            let v2 = [deltaX, deltaY]
            headingAngle = getNewHeadingGoal(v1, v2)
            return updater()
        }
        console.log("complete!")
        motorCommand(0, 0)
        updateLCD()
        resetRobotData()
        setTimeout(resetArduino, 200)
        console.log(`Moved to x: ${xGoal} y: ${yGoal}`)
        return clearInterval(reFresh)
    }
    PID([u1, u2])
}

//the PID controller for heading adjustment
function PID(u) {
    // console.log("Computing controller outputs")
    let oldErr = robotData.headingErr
    robotData.headingErr = Number((headingAngle - robotData.heading).toFixed(3))
    let deltaErr = robotData.headingErr - oldErr
    robotData.sumErr = Number((robotData.sumErr + robotData.headingErr).toFixed(3))
    let pidOut = KP * robotData.headingErr + KI * robotData.sumErr * dt + KD * (deltaErr / dt)
    mapVals(pidOut, u)
}

//calculates the unmapped outputs for the right and left motors
function mapVals(outPut, u) {
    let v = Math.abs(Math.sqrt((u[0] * u[0]) + (u[1] * u[1])))
    v = Number(v.toFixed(3))
    let vr = Math.round((2 * v + outPut * robotData.wheelBase) / (2 * robotData.wheelRadius))
    let vl = Math.round((2 * v - outPut * robotData.wheelBase) / (2 * robotData.wheelRadius))
    //
    // data log
    console.log(headingAngle, robotData.heading, robotData.posX, robotData.posY, robotData.leftTickTotal, robotData.rightTickTotal, vl, vr)
    // console.log(vr, vl)
    motorCommand(vr, vl)
}

//maps the right and left motor outputs to pwm commands for the arduino
function motorCommand(vr, vl) {
    //forward direction == 1
    //reverse direction == 2
    //speed 5 to 35 = 200 to 255
    const vMax = 255
    const vMin = 200
    let spdL
    let spdR
    const dirL = 1
    const dirR = 1
    const upperThresh = 35
    const lowerThresh = 1
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

//resets the arduino encoder counts
function resetArduino() {
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [3])
}

//resets the robot data
//resets the error sum of the robot
function resetRobotData() {
    // let keys = Object.keys(robotData)
    // keys.forEach(key => {
    //     if (key != "ultrasonicArray" && key != "imu" && key != "wheelBase" && key != "wheelRadius" && key != "posX" && key != "posY") {
    //         robotData[key] = 0
    //     }
    // })
    // // xGoal = 0
    // // yGoal = 0
    robotData.sumErr = 0
    return console.log("Robot reset", robotData)
}

//sets the arduinos encoder counts to the last known good count upon communications error
function handleCommsErr() {
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [4, robotData.leftTickTotal, robotData.rightTickTotal])
}

//sets the refresh interval for the controller
const updater = async () => {
    if (goals.length == 0) {
        let start = await getGoal()
        if (start) {
            reFresh = setInterval(getAllData, (dt * 1000))
            console.log("got goals")
        }
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

http.listen(3000, () => console.log('listening on port 3000'))
