const _ = require('lodash');
const { API_STATUS_CODE } = require('../../consts/errorStatus');
const { setServerResponse } = require('../../common/setServerResponse');


/**
 * 
 * @description This middleware validates user login data.
 * It checks if the language, email, and password are provided and valid. 
 */
const userLoginDataValidator = async (req, res, next) => {
    const userData = {
        lg: req.body.lg,
        email: req.body.email,
        password: req.body.password
    }

    if (_.isEmpty(userData.lg)) {
        return res.status(API_STATUS_CODE.BAD_REQUEST).send(
            setServerResponse(
                API_STATUS_CODE.BAD_REQUEST,
                'language_is_required',
                'en' // Default language, can be changed based on user preference
            )
        );
    }

    // // Check if username is provided
    // if (!_.isEmpty(userData.username)) {
    //     if (typeof userData.username !== 'string' || userData.username.trim() === '') {
    //         return res.status(API_STATUS_CODE.BAD_REQUEST).send(
    //             setServerResponse(
    //                 API_STATUS_CODE.BAD_REQUEST,
    //                 'username_is_required',
    //                 userData.lg
    //             ));
    //     }
    // }

    // Check if email is provided
    if (!_.isEmpty(userData.email)) {
        if (typeof userData.email !== 'string' || !userData.email.includes('@')) {
            return res.status(API_STATUS_CODE.BAD_REQUEST).send(
                setServerResponse(
                    API_STATUS_CODE.BAD_REQUEST,
                    'email_is_required',
                    userData.lg
                ));
        }
    }
    // Check if password is provided
    if (!userData.password || typeof userData.password !== 'string' || userData.password.length < 6) {
        return res.status(API_STATUS_CODE.BAD_REQUEST).send(
            setServerResponse(
                API_STATUS_CODE.BAD_REQUEST,
                'password_is_required',
                userData.lg
            ));
    }
    req.body.userData = userData;
    next();
}

module.exports = {
    userLoginDataValidator
};