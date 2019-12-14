const five = require('johnny-five')

const hcsr04 = new five.Proximity({
    pin: "P1-16",
    controller: "HCSR04"
})

module.exports = {
    hcsr04
}

//test comment