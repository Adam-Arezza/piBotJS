const five = require('johnny-five')
const rpi = require('pi-io')
const mpu = require('mpu9250')
const inquirer = require('inquirer')
const board = new five.Board({
    io: new rpi(),
    repl: false
})

const arduino = 0x08
const KP = 40
const KI = 0.1
const KD = 0
let xGoal = 0
let yGoal = 0
let headingAngle = 0
const obstacleThresh = 30
var reFresh
let dt = 0.04
// let goals = []
// let completed = []
let rightEncodeErr = 0
let leftEncodeErr = 0
const GYRO_OFFSET = {
    x: 1.5055801526717534,
    y: -1.4851297709923665,
    z: 1.1479847328244286
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
    ultrasonicArray: [],
    distSense: [],
    imu: [],
    wheelBase: 0.2286,
    wheelRadius: 0.030,
    pwmR: 0,
    pwmL: 0,
    modes: ["go_to_goal", "follow_wall"],
    mode: undefined,
    followWallPath: [],
    obstacleHitPoint: [],
    obstacleEdge: []
}

const imu = new mpu({ device: '/dev/i2c-4', UpMagneto: false, scaleValues: true, gyroBiasOffset: GYRO_OFFSET })
imu.initialize()

////////////////////////////////////////////////////////////////////////////////////////////////
//prompts for a goal coordinate specified as an x and y distance from the robots starting position (0,0)
function getGoal() {
    // return new Promise((resolve, reject) => {
    setTimeout(resetArduino, 10)
    inquirer.prompt([
        {
            type: 'input',
            name: 'x',
            message: "x?"
        },
        {
            type: 'input',
            name: 'y',
            message: "y?"
        }

    ])
        .then((answers) => {
            xGoal = Number(answers.x)
            yGoal = Number(answers.y)
            headingAngle = Number(Math.atan2(yGoal, xGoal).toFixed(3))
            return start()
        })
        .catch((err) => {
            console.log(err)
            return
        })
}

///////////////////////////////////////////////////////////////////////////////////////////
//gets encoder, imu and ultrasonic sensor data
function getArduinoData() {
    console.log(headingAngle, robotData.heading, robotData.posX, robotData.posY, robotData.pwmL, robotData.pwmR, robotData.mode, robotData.distSense, robotData.leftTickTotal, robotData.rightTickTotal)
    robotData.imu = imu.getGyro()
    try {
        board.io.i2cConfig({
            address: arduino
        })
        board.io.i2cReadOnce(arduino, 11, (bytes) => {
            //bytes[2], [3], [4], [5] == left encoder
            //bytes[6], [7], [8], [9] == right encoder
            // robotData.ultrasonicArray = [bytes[0], bytes[1], bytes[10]]
            sonarFilter(bytes[0], bytes[1], bytes[10])
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
            // console.log(leftTick, rightTick)
            if (!robotData.deltaTR && robotData.vr) {
                rightEncodeErr++
            }
            else {
                rightEncodeErr = 0
            }
            if (!robotData.deltaTL && robotData.vl) {
                leftEncodeErr++
            }
            else {
                leftEncodeErr = 0
            }
            if (robotData.deltaTL > ticksL + 15 || leftTick < 0) {
                robotData.leftTickTotal = robotData.leftTickTotal + ticksL
                robotData.deltaTL = ticksL
            }
            else {
                robotData.leftTickTotal = leftTick
            }
            if (robotData.deltaTR > tpsR + 15 || rightTick < 0) {
                robotData.rightTickTotal = robotData.rightTickTotal + ticksR
                robotData.deltaTR = ticksR
            }
            else {
                robotData.rightTickTotal = rightTick
            }
        })
        if(robotData.distSense[1] < obstacleThresh) {
            setMode(robotData.modes[1])
        }
        if(robotData.mode == robotData.modes[0]) {
            return goToGoal()
        }
        if(robotData.mode == robotData.modes[1]) {
            return followWall()
        }
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
        stopMotors()
        handleCommsErr()
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
//Starts the main interval for the controller
function start() {
    console.log("starting navigation")
    setMode(robotData.modes[0])
    reFresh = setInterval(getArduinoData, (dt * 1000))
}

//////////////////////////////////////////////////////////////////////////////////////////////////
//sets the mode of the controller
function setMode(mode) {
    robotData.mode = mode
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
//Calculates the current pose of the robot
function getNewPos() {
    //right wheel distance in mm
    let dr 
    let dl 
    if(robotData.deltaTR) {
        dr = 2 * Math.PI * robotData.wheelRadius * (robotData.deltaTR / 40)
    }
    else if(!robotData.deltaTR && robotData.pwmR) {
        dr = 2 * Math.PI * robotData.wheelRadius * (0.545 * robotData.pwmR -3.59) * (dt / 60)
    }
    else {
        dr = 0
    }
    //left wheel distance in mm
    if(robotData.deltaTL) {
        dl = 2 * Math.PI * robotData.wheelRadius * (robotData.deltaTL / 40)
    }
    else if(!robotData.deltaTL && robotData.pwmL) {
        dl = 2 * Math.PI * robotData.wheelRadius * (0.397 * robotData.pwmL + 50.2) * (dt / 60) 
    }
    else {
        dl = 0
    }
    dr = Number(dr.toFixed(4))
    dl = Number(dl.toFixed(4))
    //center of wheelbase distance in mm
    let dc = (dl + dr) / 2
    //calculate robot heading
    let headingImu = Number((robotData.heading + robotData.imu[2] * 0.0174533 * dt).toFixed(4))
    let x = Number((robotData.posX + dc * Math.cos(robotData.heading)).toFixed(3))
    let y = Number((robotData.posY + dc * Math.sin(robotData.heading)).toFixed(3))
    let newPose = [x, y, headingImu]
    return newPose
}
/////////////////////////////////////////////////////////////////////////////////////////
//the PID controller for heading adjustment
function PID(e) {
    let oldErr = robotData.headingErr
    robotData.headingErr = e
    let deltaErr = e - oldErr
    robotData.sumErr = Number((robotData.sumErr + e).toFixed(3))
    let omega = KP * e + KI * robotData.sumErr * dt + KD * (deltaErr / dt)
    return omega
}

////////////////////////////////////////////////////////////////////////////////////////
//calculates the unmapped outputs for the right and left motors
function motorVels(w, u) {
    let velocity = Math.abs(Math.sqrt((u[0] * u[0]) + (u[1] * u[1])))
    w = Number(w.toFixed(5))
    velocity = Number(velocity.toFixed(4))
    let vr = Math.round((2 * velocity + w * robotData.wheelBase) / (2 * robotData.wheelRadius))
    let vl = Math.round((2 * velocity - w * robotData.wheelBase) / (2 * robotData.wheelRadius))
    // console.log(headingAngle, robotData.heading, robotData.headingErr, robotData.posX, robotData.posY, robotData.leftTickTotal, robotData.rightTickTotal, vr, vl)
    return [vr, vl]
}

///////////////////////////////////////////////////////////////////////////////////////////
//maps the right and left motor outputs to pwm commands for the arduino
function motorCommand(vr, vl) {
    //forward direction == 1
    const vMax = 255
    const vMin = 190
    let spdL
    let spdR
    let dirL = 1
    let dirR = 1
    const upperThresh = 100
    const lowerThresh = 1
    const threshRange = upperThresh - lowerThresh
    const maxRange = vMax - vMin

    if (vr < 0) {
        vr = 0
    }
    if (vl < 0) {
        vl = 0
    }

    robotData.vr = vr
    robotData.vl = vl

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

    spdL = Math.round(spdL)
    spdR = Math.round(spdR)
    // console.log(dirR, dirL)
    robotData.pwmR = spdR
    robotData.pwmL = spdL
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [2, dirL, spdL, dirR, spdR])
    // if (count < 3) {
    //     count++
    // }
}

////////////////////////////////////////////////////////////////////////////////////////
//commands the Arduino to stop the motors
function stopMotors() {
    board.io.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [5])
}

////////////////////////////////////////////////////////////////////////////////////////////
//reset the Arduino tick counts to the last good count in the event of a communication error
function handleCommsErr() {
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [4, robotData.leftTickTotal, robotData.rightTickTotal])
}

////////////////////////////////////////////////////////////////////////////////////////////
//drives the robot towards the goal
function goToGoal() {
    const maxErr = 0.04
    let poseUpdate = getNewPos()
    robotData.posX = poseUpdate[0]
    robotData.posY = poseUpdate[1]
    robotData.heading = poseUpdate[2]
    let xErr = xGoal - robotData.posX
    let yErr = yGoal - robotData.posY
    let thetaErr = Math.atan2(Math.sin(headingAngle - robotData.heading), Math.cos(headingAngle - robotData.heading))
    let omega = PID(thetaErr)
    let motorVelocities = motorVels(omega, [xErr, yErr])
    let atGoalPos = checkGoalReached()
    if(atGoalPos) {
        return reachedGoal()
    }
    return motorCommand(motorVelocities[0], motorVelocities[1])
}

///////////////////////////////////////////////////////////////////////////////////////////
//drives the robot along an obstacle
function followWall() {
    let poseUpdate = getNewPos()
    robotData.posX = poseUpdate[0]
    robotData.posY = poseUpdate[1]
    robotData.heading = poseUpdate[2]
    if(robotData.obstacleHitPoint.length < 1) {
        robotData.obstacleHitPoint.push(poseUpdate[0], poseUpdate[1], poseUpdate[2])
    }
    robotData.followWallPath.push([poseUpdate[0], poseUpdate[1], poseUpdate[2]])
    if(robotData.distSense[2] > obstacleThresh) {
        headingAngle = headingAngle + 0.017453*2
    }
    if(robotData.distSense[1] > obstacleThresh && robotData.distSense[2] > obstacleThresh && headingAngle != robotData.obstacleHitPoint[2]) {
        if(robotData.obstacleEdge.length < 1) {
            return robotData.obstacleEdge.push(poseUpdate[0], poseUpdate[1], poseUpdate[2])
        }
        else if(robotData.obstacleEdge.length > 1 && robotData.posY > robotData.obstacleEdge[1] + 0.2) {
            headingAngle = headingAngle - 0.17453*2
        }
    }
    let xErr = xGoal - robotData.posX
    let yErr = yGoal - robotData.posY
    let thetaErr = Math.atan2(Math.sin(headingAngle - robotData.heading), Math.cos(headingAngle - robotData.heading))
    let omega = PID(thetaErr)
    let motorVelocities = motorVels(omega, [xErr, yErr])
    return motorCommand(motorVelocities[0], motorVelocities[1])
}

//////////////////////////////////////////////////////////////////////////////////////////
//triggers an Arduino reset
function resetArduino() {
    board.i2cConfig({
        address: arduino
    })
    board.io.i2cWrite(arduino, [3])
    console.log("reset arduino")
}
/////////////////////////////////////////////////////////////////////////////////////////
//ends the robot navigation
function reachedGoal() {
    clearInterval(reFresh)
    console.log(`Final x position: ${robotData.posX}`)
    console.log(`Final y position: ${robotData.posY}`)
    console.log(`Final heading angle: ${robotData.heading}`)
    setTimeout(stopMotors, 20)
    setTimeout(resetArduino, 50)
}

function sonarFilter(a, b, c) {
    if(robotData.ultrasonicArray.length < 5) {
        return robotData.ultrasonicArray.push([a,b,c])
    }
    robotData.ultrasonicArray.unshift([a,b,c])
    robotData.ultrasonicArray.pop()
    let sumA = 0
    let sumB = 0
    let sumC = 0

    for(let i = 0; i < robotData.ultrasonicArray.length; i++) {
        sumA += robotData.ultrasonicArray[i][0]
        sumB += robotData.ultrasonicArray[i][1]
        sumC += robotData.ultrasonicArray[i][2]
    }

    let avgA = sumA / robotData.ultrasonicArray.length
    let avgB = sumB / robotData.ultrasonicArray.length
    let avgC = sumC / robotData.ultrasonicArray.length

    robotData.distSense[0] = Math.round(avgA)
    robotData.distSense[1] = Math.round(avgB)
    robotData.distSense[2] = Math.round(avgC)

}

function checkGoalReached() {
    if(Math.abs(robotData.posX) >= Math.abs(xGoal) && Math.abs(robotData.posY) >= Math.abs(yGoal)){
        return true
    }
    else {
        return false
    }
}

board.on("ready", function () {
    getGoal()
})
