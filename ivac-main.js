// ==UserScript==
// @name         IVAC_PANEL_DYNAMIC_AND_MANUAL-01
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Reserve/Payment + Upload/Invoice + Full Dynamic API with Payload & Headers + Per-profile PDF sets
// @match        https://app.bdtraveller.online/*
// @match        https://bdtraveller.online/*
// @match        https://appointment.ivacbd.com/*
// @match        https://api.ivacbd.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      app.bdtraveller.online
// @connect      slotbd.online
// @connect      bdtraveller.online
// @connect      challenges.cloudflare.com
// @connect      api.ivacbd.com
// @connect      cosmic-emerald-wreath.ngrok-free.dev
// @connect      quarrel-sprain-power.ngrok-free.dev
// @connect      localhost
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    if (document.getElementById('ivac-combined-shell')) return;

    // ================================================================
    // 🎯 PART 1: GLOBAL UTILITIES
    // ================================================================

     const IVAC_API_DEFAULTS = {
        baseApi: 'https://api.ivacbd.com/iams/api/v1',
        signin: 'https://api.ivacbd.com/iams/api/v1/auth/v2-sign-in',
        verifyOtp: 'https://api.ivacbd.com/iams/api/v1/otp/verifySigninOtp',
        reserveSlot: 'https://api.ivacbd.com/iams/api/v1/slots/54ea9f13-f1e2-4cea-9e18-f525e8242ccf/reserve-slot',
        getBooking: 'https://api.ivacbd.com/iams/api/v1/appointment/get-booking-config',
        dgPay: 'https://api.ivacbd.com/iams/api/v1/payment/dcd59a95-d55e-41ad-b57c-60416e01617e/dg-epay/initiate',
       cipherServer: 'https://remodeler-sudoku-unshaven.ngrok-free.dev',
        dapiServer: 'https://panning-prancing-exception.ngrok-free.dev/',
        otpPoller: 'https://slotbd.online/api/get-sms',
         //otpPoller: 'https://app.bdtraveller.online/api/get-sms',
        invoice: 'https://api.ivacbd.com/iams/api/v1/invoice/download',
        uploadFile: 'https://api.ivacbd.com/iams/api/v1/file/upload_file_v2',
        overview: 'https://api.ivacbd.com/iams/api/v1/file/over-view-v3',
        appointment: 'https://api.ivacbd.com/iams/api/v1/appointment',
        bookingConfig: 'https://api.ivacbd.com/iams/api/v1/appointment/appointment-booking-config',
        highCommissions: 'https://api.ivacbd.com/iams/api/v1/high-commissions',
        ivacCenters: 'https://api.ivacbd.com/iams/api/v1/ivac-centers',
        deleteFile: 'https://api.ivacbd.com/iams/api/v1/file/delete'
    };

    const IVAC_API_LABELS = Object.freeze({
        baseApi: 'Base API URL',
        signin: 'Signin',
        verifyOtp: 'Verify OTP',
        reserveSlot: 'Reserve Slot',
        getBooking: 'Get Booking',
        dgPay: 'Initiate',
        cipherServer: 'Cipher Server',
        dapiServer: 'DAPI Server',
        otpPoller: 'OTP Poller',
        invoice: 'Invoice',
        uploadFile: 'Upload File',
        overview: 'Overview',
        appointment: 'Appointment',
        bookingConfig: 'Booking Conf',
        highCommissions: 'High Comm',
        ivacCenters: 'IVAC Centers',
        deleteFile: 'Delete File'
    });

    // ─── GLOBAL STATE ────────────────────────────────────────────────
    window.__IVAC = window.__IVAC || {
        turnstile: {
            widgetId: null,
            token: '',
            tokenTime: 0,
            tokenValidMs: 120000,
            sitekey: '0x4AAAAAACghKkJHL1t7UkuZ',
            isRendering: false
        },
        otp: {
            poller: null,
            active: false,
            phone: '',
            callback: null
        },
        audio: {
            context: null
        },
        api: {
            config: {},
            defaults: { ...IVAC_API_DEFAULTS }
        },
        tokenPool: [],
        sharedProfile: {
            phone: GM_getValue('ivac_phone', ''),
            password: GM_getValue('ivac_password', ''),
            listeners: []
        },
        auth: {
            token: '',
            userId: '',
            requestId: '',
            appointmentId: '',
            slotId: '54ea9f13-f1e2-4cea-9e18-f525e8242ccf',
            dgepayId: 'dcd59a95-d55e-41ad-b57c-60416e01617e'
        },
        dynamicApi: {
            isLoaded: false,
            api: null,
            endpoints: {},
            headers: {},
            payloads: {},
            constants: {}
        }
    };

    // Load saved API config
    try {
        const saved = GM_getValue('ivac_api_config', '');
        if (saved) window.__IVAC.api.config = JSON.parse(saved);
    } catch (e) {}

    // Load saved auth
    try {
        const raw = localStorage.getItem('auth-storage');
        if (raw) {
            const a = JSON.parse(raw);
            if (a.state?.token) window.__IVAC.auth.token = a.state.token;
            if (a.state?.requestId) window.__IVAC.auth.requestId = a.state.requestId;
            if (a.state?.userId) window.__IVAC.auth.userId = a.state.userId;
        }
    } catch (e) {}

    // Load saved appointment
    try {
        const saved = localStorage.getItem('ivac-appt-id');
        if (saved) window.__IVAC.auth.appointmentId = saved;
    } catch (e) {}

    // ─── API MANAGER ──────────────────────────────────────────────────
    const APIManager = {
        get(key) {
            const config = window.__IVAC.api.config;
            const defaults = window.__IVAC.api.defaults;
            return config[key] || defaults[key] || '';
        },

        set(key, value) {
            window.__IVAC.api.config[key] = value;
            try {
                GM_setValue('ivac_api_config', JSON.stringify(window.__IVAC.api.config));
            } catch (e) {}
        },

        getAll() {
            return { ...window.__IVAC.api.defaults, ...window.__IVAC.api.config };
        },

        reset() {
            window.__IVAC.api.config = {};
            try {
                GM_setValue('ivac_api_config', '');
            } catch (e) {}
        },

        getLabels() {
            return { ...IVAC_API_LABELS };
        }
    };



    function getSecHeaders() {
    const a = window.__IVAC.auth;
    return {
        nav:     a.secNavState     || 'v80d51dc5-af20-46fa-a7bb-e6a8f3f80065',
        meta:    a.vRequestMeta    || 'windos.sss',
        runtime: a.secRuntimeState || 'v4.5s4c8831.9a53.27ed.b579.042a2c0cee5a'
    };
}

    // ================================================================
    // 🎯 PART 2: ENHANCED DYNAMIC API MANAGER
    // ================================================================

   // ==========================================
// DYNAMIC ENDPOINT DETECTOR
// (Synced with detector.go — camelCase + snake_case + kebab-case + version prefix/suffix + catch-all)
// ==========================================
class DynamicEndpointDetector {
    constructor() {
        this._patterns = {

            // ── signIn ────────────────────────────────────────────────────────────
            signIn: {
                patterns: [
                    // camelCase / PascalCase
                    /^postAuthV\d+SignIn$/i, /^postAuthV\d+Signin$/i, /^authV\d+SignIn$/i,
                    /^postAuthSignIn$/i, /^authSignIn$/i, /^postSignIn$/i,
                    /^signIn$/i, /^signin$/i, /^login$/i, /^authenticate$/i,
                    /^userLogin$/i, /^postLogin$/i, /^authLogin$/i,
                    /^postAuthV3SignIn$/i, /^authV3SignIn$/i, /^v3SignIn$/i, /^v\d+SignIn$/i,
                    // snake_case / kebab-case
                    /^sign[_-]in$/i, /^post[_-]sign[_-]in$/i, /^auth[_-]sign[_-]in$/i,
                    /^post[_-]auth[_-]sign[_-]in$/i, /^user[_-]sign[_-]in$/i,
                    /^user[_-]login$/i, /^post[_-]login$/i, /^auth[_-]login$/i,
                    /^post[_-]authenticate$/i,
                    // version prefix
                    /^v\d+[_-]sign[_-]?in$/i, /^v\d+[_-]post[_-]?sign[_-]?in$/i,
                    /^v\d+[_-]auth[_-]?sign[_-]?in$/i, /^v\d+[_-]login$/i,
                    /^v\d+[_-]authenticate$/i, /^post[_-]auth[_-]v\d+[_-]sign[_-]?in$/i,
                    /^auth[_-]v\d+[_-]sign[_-]?in$/i,
                    // version suffix
                    /^sign[_-]?in[_-]v\d+$/i, /^post[_-]?sign[_-]?in[_-]v\d+$/i,
                    /^auth[_-]?sign[_-]?in[_-]v\d+$/i, /^login[_-]v\d+$/i,
                    /^post[_-]?auth[_-]?sign[_-]?in[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:post[_-]?)?(?:auth[_-]?)?v\d+[_-]?sign[_-]?in$/i,
                    /^(?:post[_-]?)?(?:auth[_-]?)?sign[_-]?in[_-]?v\d+$/i,
                ],
                keywords: ['signin', 'login', 'auth', 'authenticate', 'credential'],
            },

            // ── verifyOtp ─────────────────────────────────────────────────────────
            verifyOtp: {
                patterns: [
                    // camelCase / PascalCase
                    /^postOtpVerifysigninotp$/i, /^postOtpVerifysigninOtp$/i,
                    /^verifyOtp$/i, /^postVerifyOtp$/i, /^otpVerify$/i,
                    /^validateOtp$/i, /^verifySigninOtp$/i, /^postOtpVerify$/i,
                    /^otpVerification$/i, /^verifyOTP$/i,
                    // snake_case / kebab-case
                    /^verify[_-]otp$/i, /^post[_-]verify[_-]otp$/i, /^otp[_-]verify$/i,
                    /^validate[_-]otp$/i, /^post[_-]validate[_-]otp$/i,
                    /^verify[_-]signin[_-]otp$/i, /^post[_-]otp[_-]verify$/i,
                    /^otp[_-]verification$/i,
                    /^post[_-]otp[_-]verify[_-]signin[_-]otp$/i,
                    // version prefix
                    /^v\d+[_-]verify[_-]?otp$/i, /^v\d+[_-]otp[_-]?verify$/i,
                    /^v\d+[_-]validate[_-]?otp$/i, /^post[_-]v\d+[_-]verify[_-]?otp$/i,
                    // version suffix
                    /^verify[_-]?otp[_-]v\d+$/i, /^otp[_-]?verify[_-]v\d+$/i,
                    /^validate[_-]?otp[_-]v\d+$/i,
                    // v{N} embedded  e.g. postOtpV5VerifySigninOtp
                    /^(?:post[_-]?)?otp[_-]?v\d+[_-]?verify[_-]?(?:signin[_-]?)?otp$/i,
                    /^(?:post[_-]?)?otp[_-]?v\d+[_-]?verify[_-]?(?:sign[_-]?in[_-]?)?otp$/i,
                    // flexible catch-all
                    /^(?:post[_-]?)?(?:otp[_-]?)?(?:v\d+[_-]?)?verify[_-]?(?:signin[_-]?)?otp(?:[_-]v\d+)?$/i,
                    /^(?:post[_-]?)?(?:otp[_-]?)?(?:v\d+[_-]?)?verify[_-]?(?:sign[_-]?in[_-]?)?otp(?:[_-]v\d+)?$/i,
                ],
                keywords: ['otp', 'verify', 'validate', 'confirm', 'code', 'verification'],
            },

            // ── appointment ───────────────────────────────────────────────────────
            appointment: {
                // funcGuard: only accept a function whose name contains an appointment-
                // related keyword (mirrors Go's appointmentFuncPat). Prevents generic
                // utility functions that happen to call /appointment from being matched.
                funcGuard: /(appointment|book|schedule|makeAppoint|createAppoint)/i,
                patterns: [
                    // camelCase / PascalCase
                    /^postAppointment$/i, /^createAppointment$/i, /^bookAppointment$/i,
                    /^makeAppointment$/i, /^appointment$/i, /^scheduleAppointment$/i,
                    /^postAppointmentV\d+$/i, /^postV\d+Appointment$/i,
                    // snake_case / kebab-case
                    /^post[_-]appointment$/i, /^create[_-]appointment$/i,
                    /^book[_-]appointment$/i, /^make[_-]appointment$/i,
                    /^schedule[_-]appointment$/i,
                    // version prefix
                    /^v\d+[_-]appointment$/i, /^v\d+[_-]post[_-]?appointment$/i,
                    /^post[_-]v\d+[_-]appointment$/i, /^v\d+[_-]create[_-]?appointment$/i,
                    /^v\d+[_-]book[_-]?appointment$/i,
                    // version suffix
                    /^appointment[_-]v\d+$/i, /^post[_-]?appointment[_-]v\d+$/i,
                    /^create[_-]?appointment[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:post|create|book|make|schedule)[_-]?(?:v\d+[_-]?)?appointment(?:[_-]v\d+)?$/i,
                ],
                keywords: ['appointment', 'book', 'create', 'make', 'schedule'],
            },

            // ── bookingConfig ─────────────────────────────────────────────────────
            bookingConfig: {
                patterns: [
                    // camelCase / PascalCase
                    /^postAppointmentAppointmentBookingConfig$/i, /^postBookingConfig$/i,
                    /^setBookingConfig$/i, /^bookingConfig$/i,
                    // snake_case / kebab-case
                    /^booking[_-]config$/i, /^post[_-]booking[_-]config$/i,
                    /^set[_-]booking[_-]config$/i,
                    /^post[_-]appointment[_-]booking[_-]config$/i,
                    /^appointment[_-]booking[_-]config$/i, /^configure[_-]booking$/i,
                    // version prefix
                    /^v\d+[_-]booking[_-]?config$/i,
                    /^v\d+[_-]post[_-]?booking[_-]?config$/i,
                    /^post[_-]v\d+[_-]booking[_-]?config$/i,
                    // version suffix
                    /^booking[_-]?config[_-]v\d+$/i,
                    /^post[_-]?booking[_-]?config[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:post|set)[_-]?(?:v\d+[_-]?)?booking[_-]?config(?:[_-]v\d+)?$/i,
                ],
                keywords: ['booking', 'config', 'appointment', 'configure', 'setup'],
            },

            // ── getBookingConfig ──────────────────────────────────────────────────
            getBookingConfig: {
                patterns: [
                    // camelCase / PascalCase
                    /^getAppointmentGetBookingConfig$/i, /^getBookingConfig$/i,
                    /^fetchBookingConfig$/i, /^loadBookingConfig$/i,
                    // snake_case / kebab-case
                    /^get[_-]booking[_-]config$/i, /^fetch[_-]booking[_-]config$/i,
                    /^load[_-]booking[_-]config$/i,
                    /^get[_-]appointment[_-]booking[_-]config$/i,
                    /^get[_-]appointment[_-]get[_-]booking[_-]config$/i,
                    /^retrieve[_-]booking[_-]config$/i,
                    // version prefix
                    /^v\d+[_-]get[_-]?booking[_-]?config$/i,
                    /^v\d+[_-]fetch[_-]?booking[_-]?config$/i,
                    /^get[_-]v\d+[_-]booking[_-]?config$/i,
                    // version suffix
                    /^get[_-]?booking[_-]?config[_-]v\d+$/i,
                    /^fetch[_-]?booking[_-]?config[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:get|fetch|load|retrieve)[_-]?(?:v\d+[_-]?)?(?:appointment[_-]?)?booking[_-]?config(?:[_-]v\d+)?$/i,
                ],
                keywords: ['get', 'booking', 'config', 'fetch', 'load', 'retrieve'],
            },

            // ── reserveSlot ───────────────────────────────────────────────────────
            reserveSlot: {
                patterns: [
                    // camelCase / PascalCase
                    /^postSlotsReserveSlot$/i, /^reserveSlot$/i, /^postReserveSlot$/i,
                    /^reserve$/i, /^bookSlot$/i,
                    // snake_case / kebab-case
                    /^reserve[_-]slot$/i, /^post[_-]reserve[_-]slot$/i,
                    /^book[_-]slot$/i, /^post[_-]slots[_-]reserve[_-]slot$/i,
                    /^hold[_-]slot$/i, /^slot[_-]reserve$/i,
                    // version prefix
                    /^v\d+[_-]reserve[_-]?slot$/i, /^v\d+[_-]book[_-]?slot$/i,
                    /^post[_-]v\d+[_-]reserve[_-]?slot$/i,
                    // version suffix
                    /^reserve[_-]?slot[_-]v\d+$/i, /^book[_-]?slot[_-]v\d+$/i,
                    /^post[_-]?reserve[_-]?slot[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:post[_-]?)?(?:slots[_-]?)?(?:v\d+[_-]?)?(?:reserve|book)[_-]?slot(?:[_-]v\d+)?$/i,
                ],
                keywords: ['reserve', 'slot', 'book', 'hold', 'reservation'],
            },

            // ── paymentInitiate ───────────────────────────────────────────────────
            paymentInitiate: {
                patterns: [
                    // camelCase / PascalCase
                    /^postPaymentDgepayInitiate$/i, /^postPaymentDgEpPay$/i,
                    /^postPaymentDgEpPayInitiate$/i, /^dgepayInitiate$/i,
                    /^dgEpPayInitiate$/i, /^paymentDgepayInitiate$/i,
                    /^initiatePayment$/i, /^postPaymentInitiate$/i, /^paymentInitiate$/i,
                    // dgpay (without 'e') variants
                    /^postPaymentDgpayInitiate$/i, /^paymentDgpayInitiate$/i, /^dgpayInitiate$/i,
                    // snake_case / kebab-case
                    /^payment[_-]initiate$/i, /^post[_-]payment[_-]initiate$/i,
                    /^initiate[_-]payment$/i, /^dgepay[_-]initiate$/i,
                    /^dge[_-]pay[_-]initiate$/i,
                    /^post[_-]payment[_-]dgepay[_-]initiate$/i,
                    /^post[_-]payment[_-]dge[_-]pay[_-]initiate$/i,
                    /^payment[_-]dgepay[_-]initiate$/i,
                    /^post[_-]dgepay[_-]initiate$/i,
                    /^dgpay[_-]initiate$/i,
                    /^post[_-]payment[_-]dgpay[_-]initiate$/i,
                    /^payment[_-]dgpay[_-]initiate$/i,
                    // version prefix
                    /^v\d+[_-]payment[_-]?initiate$/i, /^v\d+[_-]dgepay[_-]?initiate$/i,
                    /^v\d+[_-]dgpay[_-]?initiate$/i, /^v\d+[_-]initiate[_-]?payment$/i,
                    /^post[_-]v\d+[_-]payment[_-]?initiate$/i,
                    // version suffix
                    /^payment[_-]?initiate[_-]v\d+$/i, /^dgepay[_-]?initiate[_-]v\d+$/i,
                    /^dgpay[_-]?initiate[_-]v\d+$/i,
                    /^post[_-]?payment[_-]?initiate[_-]v\d+$/i,
                    // flexible catch-all (handles dgepay / dgpay / dg-epay / dg_epay)
                    /^(?:post[_-]?)?(?:v\d+[_-]?)?payment[_-]?(?:dg[_-]?e?[_-]?pay[_-]?)?initiate(?:[_-]v\d+)?$/i,
                    /^(?:post[_-]?)?(?:v\d+[_-]?)?(?:dg[_-]?e?[_-]?pay)[_-]?initiate(?:[_-]v\d+)?$/i,
                ],
                keywords: ['payment', 'initiate', 'dgepay', 'dgpay', 'dgep', 'dg-epay', 'pay'],
            },

            // ── overview ──────────────────────────────────────────────────────────
            overview: {
                patterns: [
                    // camelCase / PascalCase
                    /^postFileOverViewV3$/i, /^postFileOverViewV\d+$/i,
                    /^fileOverview$/i, /^overview$/i, /^postOverview$/i,
                    /^getOverview$/i, /^fileOverView$/i,
                    // snake_case / kebab-case
                    /^file[_-]overview$/i, /^file[_-]over[_-]view$/i,
                    /^post[_-]overview$/i, /^get[_-]overview$/i,
                    /^post[_-]file[_-]overview$/i, /^post[_-]file[_-]over[_-]view$/i,
                    // version prefix
                    /^v\d+[_-]overview$/i, /^v\d+[_-]file[_-]?overview$/i,
                    /^post[_-]file[_-]over[_-]?view[_-]v\d+$/i,
                    /^post[_-]v\d+[_-]overview$/i,
                    // version suffix
                    /^overview[_-]v\d+$/i, /^file[_-]?overview[_-]v\d+$/i,
                    /^post[_-]?file[_-]?over[_-]?view[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:post|get)[_-]?(?:file[_-]?)?(?:v\d+[_-]?)?over[_-]?view(?:[_-]v\d+)?$/i,
                ],
                keywords: ['overview', 'file', 'list', 'view', 'get'],
            },

            // ── deleteFile ────────────────────────────────────────────────────────
            deleteFile: {
                patterns: [
                    // camelCase / PascalCase
                    /^deleteFileDelete$/i, /^deleteFile$/i, /^removeFile$/i,
                    // snake_case / kebab-case
                    /^delete[_-]file$/i, /^remove[_-]file$/i,
                    /^delete[_-]file[_-]delete$/i, /^erase[_-]file$/i, /^clear[_-]file$/i,
                    // version prefix
                    /^v\d+[_-]delete[_-]?file$/i, /^v\d+[_-]remove[_-]?file$/i,
                    /^delete[_-]v\d+[_-]file$/i,
                    // version suffix
                    /^delete[_-]?file[_-]v\d+$/i, /^remove[_-]?file[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:delete|remove|erase|clear)[_-]?(?:v\d+[_-]?)?file(?:[_-]v\d+)?$/i,
                ],
                keywords: ['delete', 'remove', 'file', 'erase', 'clear'],
            },

            // ── uploadFile ────────────────────────────────────────────────────────
            uploadFile: {
                patterns: [
                    // camelCase / PascalCase
                    /^postFileUploadFileV2232$/i, /^postFileUploadFileV2$/i,
                    /^uploadFile$/i, /^postUpload$/i, /^fileUpload$/i,
                    /^postFileUpload$/i, /^uploadFiles$/i,
                    /^postFileUploadFileV\d+$/i,
                    // snake_case / kebab-case
                    /^upload[_-]file$/i, /^upload[_-]files$/i, /^post[_-]upload$/i,
                    /^file[_-]upload$/i, /^post[_-]file[_-]upload$/i,
                    /^post[_-]upload[_-]file$/i, /^post[_-]file[_-]upload[_-]file$/i,
                    // version prefix
                    /^v\d+[_-]upload[_-]?file$/i, /^v\d+[_-]file[_-]?upload$/i,
                    /^post[_-]file[_-]upload[_-]file[_-]v\d+$/i,
                    /^post[_-]v\d+[_-]upload[_-]?file$/i,
                    // version suffix
                    /^upload[_-]?file[_-]v\d+$/i, /^file[_-]?upload[_-]v\d+$/i,
                    /^post[_-]?file[_-]?upload[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:post[_-]?)?(?:file[_-]?)?(?:v\d+[_-]?)?upload[_-]?files?(?:[_-]v\d+)?$/i,
                ],
                keywords: ['upload', 'file', 'post', 'send', 'document', 'files'],
            },

            // ── invoiceDownload ───────────────────────────────────────────────────
            invoiceDownload: {
                patterns: [
                    // camelCase / PascalCase
                    /^getInvoiceByidDownload$/i, /^downloadInvoice$/i,
                    /^getInvoice$/i, /^invoiceDownload$/i, /^fetchInvoice$/i,
                    // snake_case / kebab-case
                    /^invoice[_-]download$/i, /^download[_-]invoice$/i,
                    /^get[_-]invoice$/i, /^fetch[_-]invoice$/i,
                    /^get[_-]invoice[_-]by[_-]?id[_-]download$/i,
                    /^get[_-]invoice[_-]download$/i,
                    // version prefix
                    /^v\d+[_-]invoice[_-]?download$/i,
                    /^v\d+[_-]download[_-]?invoice$/i,
                    /^get[_-]v\d+[_-]invoice$/i,
                    // version suffix
                    /^invoice[_-]?download[_-]v\d+$/i,
                    /^download[_-]?invoice[_-]v\d+$/i,
                    /^get[_-]?invoice[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:get|fetch|download)[_-]?(?:v\d+[_-]?)?invoice(?:[_-]?download)?(?:[_-]v\d+)?$/i,
                ],
                keywords: ['invoice', 'download', 'receipt'],
            },

            // ── fileStatus ────────────────────────────────────────────────────────
            fileStatus: {
                patterns: [
                    // camelCase / PascalCase
                    /^getFileFileConfirmationAndSlotStatus$/i,
                    /^getFileConfirmationAndSlotStatus$/i,
                    /^checkFileStatus$/i, /^getUploadStatus$/i, /^slotStatus$/i,
                    // snake_case / kebab-case
                    /^file[_-]status$/i, /^slot[_-]status$/i,
                    /^check[_-]file[_-]status$/i, /^get[_-]upload[_-]status$/i,
                    /^get[_-]file[_-]status$/i, /^get[_-]slot[_-]status$/i,
                    /^get[_-]file[_-]confirmation[_-]and[_-]slot[_-]status$/i,
                    /^file[_-]confirmation[_-]slot[_-]status$/i,
                    // version prefix
                    /^v\d+[_-]file[_-]?status$/i, /^v\d+[_-]slot[_-]?status$/i,
                    /^get[_-]v\d+[_-]file[_-]?status$/i,
                    // version suffix
                    /^file[_-]?status[_-]v\d+$/i, /^slot[_-]?status[_-]v\d+$/i,
                    /^check[_-]?file[_-]?status[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:get|check)?[_-]?(?:v\d+[_-]?)?(?:file|slot|upload)[_-]?status(?:[_-]v\d+)?$/i,
                ],
                keywords: ['file', 'confirmation', 'slot', 'status', 'upload', 'check'],
            },

            // ── highCommissions ───────────────────────────────────────────────────
            highCommissions: {
                patterns: [
                    // camelCase / PascalCase
                    /^getHighCommissions$/i, /^highCommissions$/i,
                    /^fetchHighCommissions$/i, /^getCommissionList$/i,
                    // snake_case / kebab-case
                    /^high[_-]commissions$/i, /^get[_-]high[_-]commissions$/i,
                    /^fetch[_-]high[_-]commissions$/i, /^get[_-]commission[_-]list$/i,
                    /^commission[_-]list$/i, /^high[_-]commission[_-]list$/i,
                    // version prefix
                    /^v\d+[_-]high[_-]?commissions$/i,
                    /^v\d+[_-]commission[_-]?list$/i,
                    /^get[_-]v\d+[_-]high[_-]?commissions$/i,
                    // version suffix
                    /^high[_-]?commissions[_-]v\d+$/i,
                    /^commission[_-]?list[_-]v\d+$/i,
                    /^get[_-]?high[_-]?commissions[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:get|fetch)?[_-]?(?:v\d+[_-]?)?high[_-]?commissions(?:[_-]v\d+)?$/i,
                ],
                keywords: ['high', 'commissions', 'get', 'commission', 'list', 'fetch'],
            },

            // ── ivacCenters ───────────────────────────────────────────────────────
            ivacCenters: {
                patterns: [
                    /^getIvacCentersByid$/i, /^getIvacCenters$/i, /^ivacCenters$/i,
                    /^getCenters$/i, /^fetchIvacCenters$/i, /^getIvacCenter$/i,
                    // snake_case / kebab-case
                    /^get[_-]ivac[_-]centers$/i, /^ivac[_-]centers$/i,
                    /^get[_-]ivac[_-]center[_-]?by[_-]?id$/i,
                    /^fetch[_-]ivac[_-]centers$/i, /^get[_-]centers$/i,
                    // version prefix
                    /^v\d+[_-]ivac[_-]?centers$/i,
                    /^get[_-]v\d+[_-]ivac[_-]?centers$/i,
                    // version suffix
                    /^ivac[_-]?centers[_-]v\d+$/i,
                    /^get[_-]?ivac[_-]?centers[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:get|fetch)?[_-]?(?:v\d+[_-]?)?ivac[_-]?centers?(?:[_-]?by[_-]?id)?(?:[_-]v\d+)?$/i,
                ],
                keywords: ['ivac', 'centers', 'get', 'byid', 'center'],
            },

            // ── invoiceDownloadXToken ─────────────────────────────────────────────
            // Distinct from invoiceDownload — URL has a trailing xToken segment after "download"
            invoiceDownloadXToken: {
                patterns: [
                    // camelCase / PascalCase
                    /^getInvoiceWithXToken$/i, /^getInvoiceDownloadWithToken$/i,
                    /^invoiceDownloadXToken$/i, /^getInvoiceWithToken$/i,
                    /^downloadInvoiceXToken$/i,
                    // snake_case / kebab-case
                    /^invoice[_-]download[_-]x[_-]?token$/i,
                    /^get[_-]invoice[_-]with[_-]x[_-]?token$/i,
                    /^get[_-]invoice[_-]download[_-]with[_-]token$/i,
                    /^get[_-]invoice[_-]with[_-]token$/i,
                    /^download[_-]invoice[_-]x[_-]?token$/i,
                    /^invoice[_-]x[_-]?token$/i, /^get[_-]invoice[_-]x[_-]?token$/i,
                    // version prefix
                    /^v\d+[_-]invoice[_-]?download[_-]?x[_-]?token$/i,
                    /^v\d+[_-]get[_-]?invoice[_-]?x[_-]?token$/i,
                    /^get[_-]v\d+[_-]invoice[_-]?x[_-]?token$/i,
                    // version suffix
                    /^invoice[_-]?download[_-]?x[_-]?token[_-]v\d+$/i,
                    /^get[_-]?invoice[_-]?x[_-]?token[_-]v\d+$/i,
                    // flexible catch-all
                    /^(?:get|download)?[_-]?(?:v\d+[_-]?)?invoice[_-]?(?:download[_-]?)?x[_-]?token(?:[_-]v\d+)?$/i,
                ],
                keywords: ['invoice', 'xtoken', 'buildxtoken', 'withtoken', 'token', 'byid', 'txr'],
            },
        };

        // Synced with Go's BodyFields  ─────────────────────────────────────────────
        this._paramPatterns = {
            signIn:                ['phone', 'password', 'c'],
            verifyOtp:             ['requestId', 'phone', 'code', 'otpChannel'],
            bookingConfig:         ['mission', 'ivacCenter'],
            reserveSlot:           ['c', 'appointmentDate'],
            paymentInitiate:       ['appointmentId'],
            uploadFile:            ['files', 'isPrimary'],
            deleteFile:            ['fileNumber'],
            invoiceDownload:       ['txrId'],
            invoiceDownloadXToken: ['txrId', 'xToken'],
        };
    }

    detectEndpoints(api) {
        if (!api || typeof api !== 'object') return {};
        const detected = {}, allFunctions = this._getAllFunctions(api);
        for (const [type, config] of Object.entries(this._patterns)) {
            const matched = this._findMatchingFunction(allFunctions, config);
            if (matched) detected[type] = matched.name;
        }
        for (const type of Object.keys(this._patterns).filter(p => !detected[p])) {
            const matched = this._detectByParams(allFunctions, type);
            if (matched) detected[type] = matched.name;
        }
        for (const type of Object.keys(this._patterns).filter(p => !detected[p])) {
            const matched = this._detectByNameSimilarity(allFunctions, type);
            if (matched) detected[type] = matched.name;
        }
        return detected;
    }

    _getAllFunctions(api) {
        const functions = [], visited = new Set();
        const traverse = (obj, path = '') => {
            if (!obj || typeof obj !== 'object') return;
            for (const [key, value] of Object.entries(obj)) {
                const fullPath = path ? `${path}.${key}` : key;
                if (visited.has(fullPath)) continue; visited.add(fullPath);
                if (typeof value === 'function') {
                    functions.push({ name: key, fullPath, func: value, paramNames: this._getParameterNames(value), source: value.toString() });
                } else if (typeof value === 'object' && value !== null) {
                    traverse(value, fullPath);
                }
            }
        };
        traverse(api); return functions;
    }

    _getParameterNames(func) {
        try {
            const match = func.toString().match(/^\s*(?:async\s+)?function\s*(?:\w+)?\s*\(([^)]*)\)/);
            return match?.[1] ? match[1].split(',').map(p => p.trim()).filter(Boolean) : [];
        } catch (e) { return []; }
    }

    _findMatchingFunction(functions, config) {
        let best = null, bestConf = 0;
        for (const func of functions) {
            // funcGuard: if the config declares a guard (e.g. appointment), skip
            // any function whose name does NOT match — prevents false positives.
            if (config.funcGuard && !config.funcGuard.test(func.name)) continue;
            if (config.patterns.some(p => p.test(func.name))) {
                if (1 > bestConf) { bestConf = 1; best = { ...func, confidence: 1 }; }
                continue;
            }
            const lc = func.name.toLowerCase();
            let conf = config.keywords.reduce((a, k) => a + (lc.includes(k) ? 0.2 : 0), 0);
            if (/^post/i.test(func.name)) conf += 0.1;
            if (/^get/i.test(func.name))  conf += 0.1;
            if (/^v\d+/i.test(func.name)) conf += 0.05;
            if (conf >= 0.3 && conf > bestConf) { bestConf = conf; best = { ...func, confidence: Math.min(conf, 1) }; }
        }
        return best;
    }

    _detectByParams(functions, type) {
        const expected = this._paramPatterns[type] || [];
        if (!expected.length) return null;
        const guard = this._patterns[type]?.funcGuard;
        let best = null, bestScore = 0;
        for (const func of functions) {
            if (guard && !guard.test(func.name)) continue;
            const params = func.paramNames.map(p => p.toLowerCase());
            let score = expected.reduce((a, e) => a + (params.some(p => p.includes(e)) ? 1 : 0), 0);
            const lc = func.name.toLowerCase();
            score += (this._patterns[type]?.keywords || []).reduce((a, k) => a + (lc.includes(k) ? 0.5 : 0), 0);
            if (score > bestScore) { bestScore = score; best = { ...func, confidence: Math.min(score / (expected.length + 1), 1) }; }
        }
        return best && bestScore > 0 ? best : null;
    }

    _detectByNameSimilarity(functions, type) {
        const config = this._patterns[type]; if (!config) return null;
        let best = null, bestScore = 0;
        for (const func of functions) {
            if (config.funcGuard && !config.funcGuard.test(func.name)) continue;
            const lc = func.name.toLowerCase();
            let score = config.keywords.reduce((a, k) => a + (lc.includes(k) ? 1 : 0), 0);
            if (config.patterns.some(p => p.test(func.name))) score += 2;
            if (score > bestScore) { bestScore = score; best = { ...func, confidence: Math.min(score / 3, 1) }; }
        }
        return best && bestScore > 0 ? best : null;
    }

    validateEndpoints(detected) {
        const required = [
            'signIn', 'verifyOtp', 'appointment', 'bookingConfig', 'getBookingConfig',
            'reserveSlot', 'paymentInitiate', 'overview', 'deleteFile', 'uploadFile',
            'invoiceDownload', 'fileStatus', 'highCommissions', 'ivacCenters', 'invoiceDownloadXToken'
        ];
        const missing = required.filter(r => !detected[r]);
        return {
            allFound: !missing.length, found: Object.keys(detected), missing,
            total: required.length, foundCount: Object.keys(detected).length, missingCount: missing.length
        };
    }

    suggestFunctionNames(type) {
        const config = this._patterns[type];
        const fallbacks = {
            signIn:                ['login','auth','authenticate','userLogin','postLogin','authLogin','signInUser','v3SignIn','postAuthV3SignIn'],
            verifyOtp:             ['validateOtp','checkOtp','confirmOtp','verifyCode','otpValidate','otpCheck','otpVerification'],
            appointment:           ['bookAppointment','makeAppointment','createAppointment','appointmentCreate','newAppointment'],
            bookingConfig:         ['configBooking','setBookingConfig','updateBookingConfig','bookingConfigure','appointmentConfig','postAppointmentAppointmentBookingConfig'],
            getBookingConfig:      ['fetchBookingConfig','loadBookingConfig','retrieveBookingConfig','getBooking','getAppointmentConfig','getAppointmentGetBookingConfig'],
            reserveSlot:           ['bookSlot','holdSlot','slotReserve','reserve','reserveAppointment'],
            paymentInitiate:       ['startPayment','createPayment','paymentStart','initiateDgepay','dgEpPayInitiate','dgpayInitiate','paymentDgepayInitiate','postPaymentDgEpPayInitiate'],
            overview:              ['getFiles','listFiles','fileList','getOverview','viewFiles','postFileOverViewV3'],
            deleteFile:            ['removeFile','fileDelete','remove','eraseFile','deleteDocument'],
            uploadFile:            ['postUpload','fileUpload','upload','sendFile','uploadDocument','postFileUploadFileV2','postFileUploadFileV2232'],
            invoiceDownload:       ['getInvoice','downloadInvoice','invoiceGet','fetchInvoice','getReceipt','getInvoiceByidDownload'],
            fileStatus:            ['getFileStatus','checkFileStatus','getUploadStatus','slotStatus','getFileConfirmation','getFileConfirmationAndSlotStatus'],
            highCommissions:       ['getHighCommissions','highCommissions','getHighCommission','fetchHighCommissions','getCommissionList'],
            ivacCenters:           ['getIvacCentersByid','getIvacCenters','ivacCenters','getCenters'],
            invoiceDownloadXToken: ['getInvoiceWithXToken','getInvoiceDownloadWithToken','invoiceDownloadXToken','downloadInvoiceXToken','getInvoiceWithToken'],
        };
        const base = config ? config.patterns.map(p => p.source.replace(/[\/^$]/g, '')) : [];
        return [...new Set([...base, ...(fallbacks[type] || [])])];
    }
}


    class EnhancedDynamicApiManager {
    constructor() {
        this.api = null;
        this.isLoaded = false;
        this.isLoading = false;
        this.loadError = null;
        this._endpointCache = {};
        this._headerCache = {};
        this._payloadCache = {};
        this._constants = {};
        this.userLoaded = false;
        this.apiUrl = APIManager.get('dapiServer');
        this._detector = new DynamicEndpointDetector();

        // detector শুধু নাম ধরে; params/headers এখানে
        this._meta = {
            signIn:          { params: ['body', 'secNavState'], headers: ['x-sec-navigation-state'] },
            verifyOtp:       { params: ['body'], headers: ['Authorization'] },
            reserveSlot:     { params: ['c', 'appointmentDate', 'xVRequestMeta'], headers: ['x-v-request-meta'] },
            uploadFile:      { params: ['files', 'isPrimary', 'secRuntimeState', 'xToken'], headers: ['x-token', 'x-sec-runtime-state'] },
            paymentInitiate: { params: ['appointmentId', 'xToken'], headers: ['x-token'] },
            invoiceDownload: { params: ['txrId', 'xToken'], headers: ['x-token'] },
            invoiceDownloadXToken: { params: ['txrId', 'xToken'], headers: ['x-token'] },
            ivacCenters:     { params: ['commissionId'], headers: ['Authorization'] },
        };
    }

    _buildGmFetch() {
        return function(url, options) {
            options = options || {};
            return new Promise(function(resolve, reject) {
                const method = options.method || 'GET';
                const headers = Object.assign({}, options.headers || {});

                if (url.includes('ngrok')) {
                    headers['ngrok-skip-browser-warning'] = 'true';
                    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
                }

                let data = null;
                if (options.body instanceof FormData) {
                    delete headers['Content-Type'];
                    data = options.body;
                } else if (options.body) {
                    data = options.body;
                }
                GM_xmlhttpRequest({
                    method: method,
                    url: url,
                    headers: headers,
                    data: data,
                    onload: function(r) {
                        const ok = r.status >= 200 && r.status < 300;
                        const text = r.responseText;
                        resolve({
                            ok: ok,
                            status: r.status,
                            statusText: r.statusText,
                            json: function() {
                                try { return Promise.resolve(JSON.parse(text)); }
                                catch (e) { return Promise.reject(e); }
                            },
                            text: function() { return Promise.resolve(text); },
                            arrayBuffer: function() { return Promise.resolve(r.response); }
                        });
                    },
                    onerror: function() { reject(new Error('Network error')); },
                    ontimeout: function() { reject(new Error('Timeout')); }
                });
            });
        };
    }

    async userLoadApi(scriptTextOrUrl, isScript = false) {
        try {
            this.isLoading = true;
            let scriptText = scriptTextOrUrl;

            if (!isScript) {
                this.apiUrl = scriptTextOrUrl;
                APIManager.set('dapiServer', scriptTextOrUrl);
                scriptText = await this._fetchScript(scriptTextOrUrl);
            }

            const parsed = this._parseApiFull(scriptText);
            this.api = parsed.api;
            this._extractConstants(parsed);
            this._detectEndpointsFull(parsed);
            this._extractPayloadStructure(parsed);
            this._extractHeaders(parsed);

            this.isLoaded = true;
            this.isLoading = false;
            this.loadError = null;
            this.userLoaded = true;

            try {
                localStorage.setItem('ivac_dynamic_api_full', JSON.stringify({
                    script: scriptText,
                    endpoints: this._endpointCache,
                    headers: this._headerCache,
                    payloads: this._payloadCache,
                    constants: this._constants,
                    timestamp: Date.now()
                }));
            } catch (e) {}

            this._autoConfigureFull();
            console.log('[DAPI] endpointPaths:', JSON.stringify(this._constants?._endpointPaths));
            console.log('[DAPI] config:', JSON.stringify(APIManager.getAll()));

            window.__IVAC.dynamicApi.isLoaded = true;
            window.__IVAC.dynamicApi.api = this.api;
            window.__IVAC.dynamicApi.endpoints = this._endpointCache;
            window.__IVAC.dynamicApi.headers = this._headerCache;
            window.__IVAC.dynamicApi.payloads = this._payloadCache;
            window.__IVAC.dynamicApi.constants = this._constants;

            return this.api;
        } catch (error) {
            this.isLoading = false;
            this.loadError = error;
            throw error;
        }
    }

    _fetchScript(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: {
                    'ngrok-skip-browser-warning': 'true',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                },
                timeout: 15000,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) resolve(response.responseText);
                    else reject(new Error(`HTTP ${response.status}: ${response.statusText}`));
                },
                onerror: function() { reject(new Error('Network error')); },
                ontimeout: function() { reject(new Error('Timeout')); }
            });
        });
    }

    _parseApiFull(scriptText) {
        if (!scriptText || !scriptText.trim()) throw new Error('Empty script');

        let api = null;
        const constants = {};

        const baseMatch = scriptText.match(/API_BASE\s*=\s*["']([^"']+)["']/);
        if (baseMatch) constants.API_BASE = baseMatch[1];

        const slotMatch = scriptText.match(/SLOT_ID\s*=\s*["']([^"']+)["']/);
        if (slotMatch) constants.SLOT_ID = slotMatch[1];

        const dgeMatch = scriptText.match(/DGEPAY_ID\s*=\s*["']([^"']+)["']/);
        if (dgeMatch) constants.DGEPAY_ID = dgeMatch[1];

        const secMatch = scriptText.match(/SEC_HEADERS\s*=\s*(\{[^}]*\})/);
if (secMatch) {
    try { constants.SEC_HEADERS = JSON.parse(secMatch[1]); } catch (e) {}
}

        // script থেকে আসল endpoint path
        const endpointPaths = {};
        const ivacReqRegex = /function\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]*?ivacRequest\s*\(\s*["'](\w+)["']\s*,\s*[`"']([^`"',)]+)/g;
        let epMatch;
        while ((epMatch = ivacReqRegex.exec(scriptText)) !== null) {
            const fnName = epMatch[1];
            const method = epMatch[2];
            let path = epMatch[3];
            const slotId = constants.SLOT_ID || '54ea9f13-f1e2-4cea-9e18-f525e8242ccf';
            const dgepayId = (constants.DGEPAY_ID && constants.DGEPAY_ID !== 'DGEPAY_ID_NOT_FOUND')
                ? constants.DGEPAY_ID
                : 'dcd59a95-d55e-41ad-b57c-60416e01617e';
            path = path.replace('${SLOT_ID}', slotId).replace('${DGEPAY_ID}', dgepayId);
            endpointPaths[fnName] = { method, path };
        }
        constants._endpointPaths = endpointPaths;

        try {
            const mod = { exports: {} };
            const _gmFetch = this._buildGmFetch();
            const fn = new Function('module', 'exports', 'GM_xmlhttpRequest', 'fetch',
                `"use strict";\n${scriptText}\nreturn module.exports;`
            );
            const result = fn(mod, mod.exports, GM_xmlhttpRequest, _gmFetch);
            if (result && typeof result === 'object' && Object.keys(result).length > 0) api = result;
        } catch (e) {}

        if (!api) api = this._extractFunctionsFull(scriptText);

        if (!api || Object.keys(api).length === 0) throw new Error('Could not parse API script');

        // script রিটার্ন করতে হবে, নইলে payload/header extract কাজ করে না
        return { api, constants, script: scriptText };
    }

    _extractFunctionsFull(scriptText) {
        const api = {};
        const names = new Set();

        const funcRegex = /(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
        let match;
        while ((match = funcRegex.exec(scriptText)) !== null) {
            names.add({ name: match[1], params: match[2].split(',').map(p => p.trim()) });
        }

        const arrowRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g;
        while ((match = arrowRegex.exec(scriptText)) !== null) {
            names.add({ name: match[1], params: match[2].split(',').map(p => p.trim()) });
        }

        for (const fnInfo of names) {
            const name = fnInfo.name;
            if (name && name.length > 1 && !['if', 'for', 'while', 'return'].includes(name)) {
                api[name] = {
                    fn: async (...args) => {
                        const _gmFetch = this._buildGmFetch();
                        const fn = new Function('args', 'GM_xmlhttpRequest', 'fetch',
                            `"use strict";\n${scriptText}\nconst _fn=typeof ${name}==='function'?${name}:null;\nif(!_fn)return{success:false,message:'${name} not found'};\ntry{const r=_fn(...args);return r?.then?await r:r;}catch(e){throw e;}`
                        );
                        return fn(args, GM_xmlhttpRequest, _gmFetch);
                    },
                    params: fnInfo.params || [],
                    name: name
                };
            }
        }
        return api;
    }

    _detectEndpointsFull(parsed) {
        const api = parsed.api;
        if (!api) return;

        // detector শুধু function চেনে; {fn, params} ফরম্যাটকে function-এ রূপান্তর
        const flat = {};
        for (const [k, v] of Object.entries(api)) {
            if (typeof v === 'function') {
                flat[k] = v;
            } else if (v && typeof v.fn === 'function') {
                const f = (...a) => v.fn(...a);
                f.toString = () => `function ${k}(${(v.params || []).join(',')}){}`;
                flat[k] = f;
            }
        }

        const detected = this._detector.detectEndpoints(flat);
        const endpoints = {};
        for (const [type, name] of Object.entries(detected)) {
            const m = this._meta[type] || {};
            endpoints[type] = {
                name,
                params: m.params || [],
                headers: m.headers || ['Authorization'],
                payload: {}
            };
        }

        this._endpointCache = endpoints;
        console.log('[DAPI] detected:', detected, this._detector.validateEndpoints(detected));
        return endpoints;
    }

    _extractPayloadStructure(parsed) {
        const payloads = {};
        const scriptText = parsed.script || '';
        let match;

        const payloadRegex = /function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*const\s+body\s*=\s*\{([^}]*)\}/gs;
        while ((match = payloadRegex.exec(scriptText)) !== null) {
            payloads[match[1]] = match[2].split(',').map(f => f.trim().split(':')[0].trim()).filter(Boolean);
        }

        const bodyRegex = /const\s+body\s*=\s*\{([^}]*)\}/g;
        while ((match = bodyRegex.exec(scriptText)) !== null) {
            const context = scriptText.substring(Math.max(0, match.index - 200), match.index);
            const fnMatch = context.match(/function\s+(\w+)\s*\(/);
            if (fnMatch && !payloads[fnMatch[1]]) {
                payloads[fnMatch[1]] = match[1].split(',').map(f => f.trim().split(':')[0].trim()).filter(Boolean);
            }
        }

        this._payloadCache = payloads;
    }

    _extractHeaders(parsed) {
        const headers = {};
        const scriptText = parsed.script || '';
        let match;

        const headerMatches = scriptText.match(/build\w*Header\w*\s*\([^)]*\)\s*\{[^}]*\}/gs) || [];
        for (const headerFn of headerMatches) {
            const nameMatch = headerFn.match(/function\s+(\w+)\s*\(/);
            if (nameMatch) {
                const headersInFn = headerFn.match(/["']([^"']+)["']\s*:/g) || [];
                const headerNames = headersInFn.map(h => h.replace(/["']/g, '').replace(':', '').trim());
                if (headerNames.length > 0) headers[nameMatch[1]] = headerNames;
            }
        }

        const headerSetRegex = /headers\s*:\s*\{([^}]*)\}/gs;
        while ((match = headerSetRegex.exec(scriptText)) !== null) {
            const headersInSet = match[1].match(/["']([^"']+)["']\s*:/g) || [];
            const headerNames = headersInSet.map(h => h.replace(/["']/g, '').replace(':', '').trim());
            if (headerNames.length > 0) {
                const context = scriptText.substring(Math.max(0, match.index - 300), match.index);
                const fnMatch = context.match(/function\s+(\w+)\s*\(/);
                if (fnMatch && !headers[fnMatch[1]]) headers[fnMatch[1]] = headerNames;
            }
        }

        this._headerCache = headers;
    }

    _extractConstants(parsed) {
        const constants = parsed.constants || {};

        if (constants.SLOT_ID) {
            window.__IVAC.auth.slotId = constants.SLOT_ID;
            localStorage.setItem('ivac_reserve_uuid', constants.SLOT_ID);
            const inp = document.getElementById('ivac-reserve-uuid');
            if (inp && !inp.value) inp.value = constants.SLOT_ID;
        }

        if (constants.DGEPAY_ID) {
            window.__IVAC.auth.dgepayId = constants.DGEPAY_ID;
            localStorage.setItem('ivac_payment_uuid', constants.DGEPAY_ID);
            localStorage.setItem('ivac_dgepay_id', constants.DGEPAY_ID);
            const inp = document.getElementById('ivac-payment-uuid');
            if (inp && !inp.value) inp.value = constants.DGEPAY_ID;
        }

        if (constants.API_BASE) APIManager.set('baseApi', constants.API_BASE);

        this._applySecHeaders(constants);

        this._constants = constants;
    }

        _applySecHeaders(constants) {
    const s = constants && constants.SEC_HEADERS;
    if (!s) return;
    const a = window.__IVAC.auth;
    if (s['x-sec-navigation-state']) a.secNavState = s['x-sec-navigation-state'];
    if (s['x-v-request-meta'])       a.vRequestMeta = s['x-v-request-meta'];
    if (s['x-sec-runtime-state'])    a.secRuntimeState = s['x-sec-runtime-state'];
    console.log('[DAPI] SEC_HEADERS applied:', s);
}

    _autoConfigureFull() {
        const config = {};
        const baseApi = this._constants?.API_BASE || APIManager.get('baseApi') || 'https://api.ivacbd.com/iams/api/v1';
        const slotId = this._constants?.SLOT_ID || window.__IVAC.auth.slotId || '54ea9f13-f1e2-4cea-9e18-f525e8242ccf';
        const rawDgepayId = this._constants?.DGEPAY_ID || '';
        const dgepayId = (rawDgepayId && rawDgepayId !== 'DGEPAY_ID_NOT_FOUND')
            ? rawDgepayId
            : (window.__IVAC.auth.dgepayId || 'dcd59a95-d55e-41ad-b57c-60416e01617e');

        const urlMapping = {
            signIn: '/auth/v2-sign-in',
            verifyOtp: '/otp/verifySigninOtp',
            reserveSlot: `/slots/${slotId}/reserve-slot`,
            getBookingConfig: '/appointment/get-booking-config',
            paymentInitiate: `/payment/${dgepayId}/dg-epay/initiate`,
            uploadFile: '/file/upload_file_v2',
            overview: '/file/over-view-v3',
            invoiceDownload: '/invoice/download',
            appointment: '/appointment',
            bookingConfig: '/appointment/appointment-booking-config',
            highCommissions: '/high-commissions',
            ivacCenters: '/ivac-centers/{commissionId}',
            deleteFile: '/file/delete'
        };

        const keyMapping = {
            signIn: 'signin',
            verifyOtp: 'verifyOtp',
            reserveSlot: 'reserveSlot',
            getBookingConfig: 'getBooking',
            paymentInitiate: 'dgPay',
            uploadFile: 'uploadFile',
            overview: 'overview',
            invoiceDownload: 'invoice',
            appointment: 'appointment',
            bookingConfig: 'bookingConfig',
            highCommissions: 'highCommissions',
            ivacCenters: 'ivacCenters',
            deleteFile: 'deleteFile'
        };

        const endpointPaths = this._constants?._endpointPaths || {};

        for (const [key, endpoint] of Object.entries(this._endpointCache)) {
            const configKey = keyMapping[key];
            if (!configKey) continue;
            const fnName = endpoint?.name;
            const actualPath = fnName && endpointPaths[fnName] ? endpointPaths[fnName].path : null;
            if (actualPath) config[configKey] = baseApi + actualPath;
            else if (urlMapping[key]) config[configKey] = baseApi + urlMapping[key];
        }

        // endpoint cache খালি/অল্প হলে path দেখে configure
        if (Object.keys(config).length <= 2) {
            for (const [fnName, ep] of Object.entries(endpointPaths)) {
                const path = ep.path;
                if (path.includes('/auth/')) config.signin = baseApi + path;
                else if (/\/otp\/.*verify/i.test(path)) config.verifyOtp = baseApi + path;
                else if (path.includes('/slots/') && path.includes('reserve')) config.reserveSlot = baseApi + path;
                else if (path.includes('/appointment/get-booking')) config.getBooking = baseApi + path;
                else if (path.includes('/payment/') && path.includes('initiate')) config.dgPay = baseApi + path;
                else if (path.includes('/file/upload')) config.uploadFile = baseApi + path;
                else if (path.includes('/file/over-view')) config.overview = baseApi + path;
                else if (path.includes('/invoice/')) config.invoice = baseApi + path;
                else if (path.includes('/appointment/appointment-booking')) config.bookingConfig = baseApi + path;
                else if (path.includes('/appointment')) config.appointment = baseApi + path;
                else if (path.includes('/high-commissions')) config.highCommissions = baseApi + path;
                else if (path.includes('/ivac-centers')) config.ivacCenters = baseApi + path;
                else if (path.includes('/file/delete')) config.deleteFile = baseApi + path;
            }
        }

        config.baseApi = baseApi;
        if (slotId) config.slotId = slotId;
        if (dgepayId) config.dgepayId = dgepayId;

        Object.entries(config).forEach(([key, value]) => {
            if (typeof value === 'string' && !['slotId', 'dgepayId'].includes(key)) {
                APIManager.set(key, value);
            }
        });

        localStorage.setItem('ivac_api_headers', JSON.stringify(this._headerCache));
        localStorage.setItem('ivac_api_payloads', JSON.stringify(this._payloadCache));
        window._ivacAPIS = APIManager.getAll();

        return config;
    }

    // ── PUBLIC METHODS ──────────────────────────────────────────

    getDetectedEndpoints() {
        return { ...this._endpointCache };
    }

    getValidationStatus() {
        const required = ['signIn', 'verifyOtp', 'appointment', 'bookingConfig', 'getBookingConfig', 'reserveSlot', 'paymentInitiate', 'overview', 'deleteFile', 'uploadFile', 'invoiceDownload'];
        const found = required.filter(key => this._endpointCache[key]);
        const missing = required.filter(key => !this._endpointCache[key]);
        return {
            isValid: missing.length === 0,
            found: found.length,
            total: required.length,
            missing: missing,
            foundList: found
        };
    }

    getHeadersForEndpoint(endpointType) {
        const endpoint = this._endpointCache[endpointType];
        return (endpoint && endpoint.headers) ? endpoint.headers : ['Authorization'];
    }

    getPayloadForEndpoint(endpointType) {
        const endpoint = this._endpointCache[endpointType];
        return (endpoint && endpoint.params) ? endpoint.params : [];
    }

    getFunctionName(endpointType) {
        const endpoint = this._endpointCache[endpointType];
        return endpoint ? endpoint.name : null;
    }

    getConstants() {
        return { ...this._constants };
    }

    loadSavedApi() {
        try {
            const saved = localStorage.getItem('ivac_dynamic_api_full');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.script) {
                    const parsed = this._parseApiFull(data.script);
                    this.api = parsed.api;
                    this._endpointCache = data.endpoints || {};
                    this._headerCache = data.headers || {};
                    this._payloadCache = data.payloads || {};
                    this._constants = data.constants || {};
                    this._applySecHeaders(parsed.constants);
                    this.isLoaded = true;
                    this.userLoaded = true;
                    window.__IVAC.dynamicApi.isLoaded = true;
                    window.__IVAC.dynamicApi.api = this.api;
                    window.__IVAC.dynamicApi.endpoints = this._endpointCache;
                    window.__IVAC.dynamicApi.headers = this._headerCache;
                    window.__IVAC.dynamicApi.payloads = this._payloadCache;
                    window.__IVAC.dynamicApi.constants = this._constants;
                    return true;
                }
            }
        } catch (e) {
            console.warn('[IVAC] loadSavedApi failed:', e);
        }
        return false;
    }

    async fetchFromDapi() {
        const url = APIManager.get('dapiServer');
        return this._fetchScript(url);
    }

    autoConfigure() {
        return this._autoConfigureFull();
    }
}

    // ─── INITIALIZE DYNAMIC API ──────────────────────────────────────

    let enhancedDynamicApiManager = null;

    function initEnhancedDynamicApiManager() {
        if (!enhancedDynamicApiManager) {
            enhancedDynamicApiManager = new EnhancedDynamicApiManager();
            enhancedDynamicApiManager.loadSavedApi();
        }
        return enhancedDynamicApiManager;
    }

    // ─── CALL DYNAMIC API ────────────────────────────────────────────
async function callDynamicAPI(endpointType, ...args) {
    const manager = initEnhancedDynamicApiManager();

    if (!manager.isLoaded || !manager.api) {
        const loaded = manager.loadSavedApi();
        if (!loaded) {
            return { _dynamicFailed: true, message: 'API not loaded' };
        }
    }

    if (!manager.api) {
        return { _dynamicFailed: true, message: 'API not loaded' };
    }

    const fnName = manager.getFunctionName(endpointType);
    if (!fnName) {
        return { _dynamicFailed: true, message: `Endpoint "${endpointType}" not found` };
    }

    try {
        const fn = manager.api[fnName];

        let result;
        if (typeof fn === 'function') {
            result = await fn(...args);
        } else if (typeof fn === 'object' && fn && typeof fn.fn === 'function') {
            result = await fn.fn(...args);
        } else {
            return { _dynamicFailed: true, message: `"${fnName}" not callable` };
        }

        // ✅ Dynamic API সফল — _dynamicFailed নেই মানে success
        return result;

    } catch (error) {
        // HTTP error (fetch-api.js throw করে error.status সহ)
        if (error.status) {
            // Request গেছে, response এসেছে — fallback যাবে না
            console.warn(`[DynamicAPI] HTTP ${error.status} from ${fnName}`);
            return {
                _dynamicCalled: true,   // request গেছে
                _httpError: true,
                status: error.status,
                message: error.message,
                body: error.body
            };
        }
        // Network/CORS error
        console.error(`[DynamicAPI] Error:`, error);
        return { _dynamicFailed: true, message: error.message };
    }
}
    // ================================================================
    // 🎯 PART 3: TURNSTILE MANAGER
    // ================================================================

    const TurnstileManager = {
        getTS() {
            return window.turnstile ||
                   (typeof unsafeWindow !== 'undefined' && unsafeWindow.turnstile) ||
                   null;
        },

        loadScript(callback) {
            if (this.getTS()) {
                callback();
                return;
            }
            const existing = document.querySelector('script[src*="turnstile"]');
            if (existing) {
                let tries = 0;
                const wait = setInterval(() => {
                    tries++;
                    if (this.getTS()) {
                        clearInterval(wait);
                        callback();
                    } else if (tries > 50) {
                        clearInterval(wait);
                        callback(new Error('Turnstile script timeout'));
                    }
                }, 200);
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.onload = () => {
                let tries = 0;
                const wait = setInterval(() => {
                    tries++;
                    if (this.getTS()) {
                        clearInterval(wait);
                        callback();
                    } else if (tries > 50) {
                        clearInterval(wait);
                        callback(new Error('Turnstile object not ready'));
                    }
                }, 200);
            };
            script.onerror = () => callback(new Error('Turnstile script load failed'));
            document.head.appendChild(script);
        },

        render(containerId, onToken, onError, onExpired) {
            const state = window.__IVAC.turnstile;
            const container = typeof containerId === 'string' ?
                document.getElementById(containerId) : containerId;

            if (!container) {
                console.error('[IVAC] Turnstile container not found');
                return;
            }

            this.destroy();

            this.loadScript((err) => {
                if (err) {
                    container.innerHTML = `<div style="color:#ef4444;font-size:11px;padding:8px;">⚠️ ${err.message}</div>`;
                    if (onError) onError(err);
                    return;
                }

                const TS = this.getTS();
                if (!TS) {
                    container.innerHTML = `<div style="color:#ef4444;font-size:11px;padding:8px;">⚠️ Turnstile not available</div>`;
                    return;
                }

                container.innerHTML = '';
                state.isRendering = true;

                try {
                    state.widgetId = TS.render(container, {
                        sitekey: state.sitekey,
                        theme: 'light',
                        size: 'normal',
                        callback: function(token) {
                            state.token = token;
                            state.tokenTime = Date.now();
                            state.isRendering = false;
                            TokenPoolManager.add(token);
                            if (onToken) onToken(token);
                        },
                        'expired-callback': function() {
                            state.token = '';
                            state.tokenTime = 0;
                            state.isRendering = false;
                            if (onExpired) onExpired();
                        },
                        'error-callback': function(code) {
                            state.isRendering = false;
                            if (onError) onError(code);
                        }
                    });
                } catch (e) {
                    state.isRendering = false;
                    container.innerHTML = `<div style="color:#ef4444;font-size:11px;padding:8px;">⚠️ ${e.message}</div>`;
                    if (onError) onError(e);
                }
            });
        },

        destroy() {
            const state = window.__IVAC.turnstile;
            if (state.widgetId !== null) {
                try {
                    const TS = this.getTS();
                    if (TS) TS.remove(state.widgetId);
                } catch (e) {}
                state.widgetId = null;
            }
            state.isRendering = false;
        },

        getToken() {
            const state = window.__IVAC.turnstile;
            if (!state.token) return null;
            if (Date.now() - state.tokenTime > state.tokenValidMs) {
                state.token = '';
                return null;
            }
            return state.token;
        },

        isTokenValid() {
            return !!this.getToken();
        },

        getRemainingSeconds() {
            const state = window.__IVAC.turnstile;
            if (!state.token) return 0;
            const remaining = state.tokenValidMs - (Date.now() - state.tokenTime);
            return Math.max(0, Math.ceil(remaining / 1000));
        },

        refresh() {
            this.destroy();
        }
    };

    // ─── TOKEN POOL MANAGER ─────────────────────────────────────────
    const TokenPoolManager = {
        _pool: [],
        _validMs: 120000,

        init() {
            try {
                const saved = localStorage.getItem('ivac-token-pool');
                if (saved) {
                    this._pool = JSON.parse(saved);
                    this._clean();
                }
            } catch (e) {}
        },

        _clean() {
            this._pool = this._pool.filter(e => (Date.now() - e.time) < this._validMs);
            this._save();
        },

        _save() {
            try {
                localStorage.setItem('ivac-token-pool', JSON.stringify(this._pool));
            } catch (e) {}
        },

        add(token) {
            this._pool.push({ token, time: Date.now() });
            this._clean();
        },

        pop() {
            this._clean();
            if (!this._pool.length) return null;
            return this._pool.shift().token;
        },

        count() {
            this._clean();
            return this._pool.length;
        },

        waitForToken(timeout = 60000) {
            return new Promise((resolve) => {
                this._clean();
                if (this._pool.length > 0) {
                    resolve(this.pop());
                    return;
                }
                const start = Date.now();
                const check = setInterval(() => {
                    this._clean();
                    if (this._pool.length > 0) {
                        clearInterval(check);
                        resolve(this.pop());
                    } else if (Date.now() - start > timeout) {
                        clearInterval(check);
                        resolve(null);
                    }
                }, 500);
            });
        }
    };

    // ─── OTP MANAGER ──────────────────────────────────────────────────
    const OTPManager = {
        _timer: null,
        _active: false,

        start(phone, onOtpFound, interval = 500, maxAttempts = 300) {
            this.stop();
            this._active = true;
            let attempts = 0;

            const apiUrl = APIManager.get('otpPoller');
            const poll = async () => {
                if (!this._active) {
                    this.stop();
                    return;
                }
                attempts++;
                try {
                    const res = await fetch(`${apiUrl}?phone=${phone}`);
                    const data = await res.json();
                    if (data?.otp) {
                        this.stop();
                        if (onOtpFound) onOtpFound(data.otp);
                        return data.otp;
                    }
                    if (attempts >= maxAttempts) {
                        this.stop();
                        if (onOtpFound) onOtpFound(null);
                    }
                } catch (e) {
                    if (attempts >= maxAttempts) {
                        this.stop();
                        if (onOtpFound) onOtpFound(null);
                    }
                }
            };

            this._timer = setInterval(poll, interval);
            poll();
        },

        stop() {
            if (this._timer) {
                clearInterval(this._timer);
                this._timer = null;
            }
            this._active = false;
        },

        isActive() {
            return this._active;
        }
    };

    // ─── AUDIO MANAGER ───────────────────────────────────────────────
    const AudioManager = {
        playBeep(frequency = 880, duration = 300) {
            try {
                let ctx = window.__IVAC.audio.context;
                if (!ctx || ctx.state === 'closed') {
                    ctx = new (window.AudioContext || window.webkitAudioContext)();
                    window.__IVAC.audio.context = ctx;
                }
                if (ctx.state === 'suspended') ctx.resume().catch(() => {});
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(frequency, ctx.currentTime);
                gain.gain.setValueAtTime(0.5, ctx.currentTime);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                setTimeout(() => {
                    try { osc.stop(); } catch (e) {}
                }, duration);
            } catch (e) {
                console.warn('[IVAC] Beep failed:', e);
            }
        }
    };

    // ─── CLIPBOARD MANAGER ───────────────────────────────────────────
    const ClipboardManager = {
        copy(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(() => this._fallbackCopy(text));
            } else {
                this._fallbackCopy(text);
            }
        },

        _fallbackCopy(text) {
            const ta = document.createElement('textarea');
            ta.value = text;
            Object.assign(ta.style, { position: 'fixed', opacity: '0', left: '-9999px' });
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
            } catch (e) {}
            document.body.removeChild(ta);
        }
    };

    // ─── PROFILE MANAGER ─────────────────────────────────────────────
    const ProfileManager = {
        _profiles: [],
        _lastIdx: '',

        load() {
            try {
                this._profiles = JSON.parse(GM_getValue('ivac_profiles', '[]')) || [];
            } catch (e) {
                this._profiles = [];
            }
            this._lastIdx = GM_getValue('ivac_last_profile', '');
            return this._profiles;
        },

        save(profiles) {
            this._profiles = profiles;
            GM_setValue('ivac_profiles', JSON.stringify(profiles));
        },

        getLast() {
            const profiles = this.load();
            if (this._lastIdx !== '' && profiles[this._lastIdx]) {
                return profiles[this._lastIdx];
            }
            return null;
        },

        setLast(idx) {
            this._lastIdx = String(idx);
            GM_setValue('ivac_last_profile', this._lastIdx);
            const list = this.load();
            const p = list[idx];
            if (p && window._ivacOnProfileChange) window._ivacOnProfileChange(p.phone);
        },

        clearLast() {
            this._lastIdx = '';
            GM_setValue('ivac_last_profile', '');
        },

        getProfileLabel(p, i, isSelected) {
            const type = p.type || 'T';
            const count = p.count || 1;
            const name = p.name ? `${p.name} ` : '';
            if (isSelected) return `${i + 1}. ${name}[${type}-${count}]`;
            return `${i + 1}. ${name}${p.phone} [${type}-${count}]`;
        }
    };

    // ─── AUTH MANAGER ─────────────────────────────────────────────────
    const AuthManager = {
        getToken() {
            try {
                const raw = localStorage.getItem('auth-storage');
                if (!raw) return '';
                const parsed = JSON.parse(raw);
                return (parsed?.state?.token) || '';
            } catch (e) {
                return '';
            }
        },

        setToken(token, data = {}) {
            try {
                const existing = localStorage.getItem('auth-storage');
                let obj = existing ? JSON.parse(existing) : { state: {}, version: 0 };
                obj.state.token = token;
                obj.state.isAuthenticated = true;
                obj.state = { ...obj.state, ...data };
                localStorage.setItem('auth-storage', JSON.stringify(obj));
                window.__IVAC.auth.token = token;
            } catch (e) {}
        },

        clear() {
            localStorage.removeItem('auth-storage');
            window.__IVAC.auth.token = '';
        },

        getAppointmentId() {
            return window.__IVAC.auth.appointmentId || localStorage.getItem('ivac-appt-id') || '';
        },

        setAppointmentId(id) {
            window.__IVAC.auth.appointmentId = id;
            try {
                localStorage.setItem('ivac-appt-id', id);
            } catch (e) {}
        }
    };

    // ─── SHARED PROFILE BRIDGE ──────────────────────────────────────
    const SharedProfile = {
        get phone() { return window.__IVAC.sharedProfile.phone; },
        get password() { return window.__IVAC.sharedProfile.password; },

        set(phone, password) {
            window.__IVAC.sharedProfile.phone = phone;
            window.__IVAC.sharedProfile.password = password;
            GM_setValue('ivac_phone', phone);
            GM_setValue('ivac_password', password);
            window.__IVAC.sharedProfile.listeners.forEach(fn => fn(phone, password));
        },

        onChange(fn) {
            window.__IVAC.sharedProfile.listeners.push(fn);
        }
    };

    // ─── CIPHER MANAGER ──────────────────────────────────────────────
    const Charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";

    function charsetIndex(ch) {
        return Charset.indexOf(ch);
    }

    function generateShiftsCellular(key, length) {
        let cur = new Uint8Array(64);
        for (let i = 0; i < key.length; i++) cur[i % 64] ^= (key.charCodeAt(i) & 1);
        cur[32] = 1;
        const shifts = [];
        for (let s = 0; s < length; s++) {
            const nx = new Uint8Array(64);
            let v = 0;
            for (let d = 0; d < 64; d++) {
                const L = cur[(d + 63) % 64],
                    C = cur[d],
                    R = cur[(d + 1) % 64];
                nx[d] = (30 >> ((L << 2) | (C << 1) | R)) & 1;
                if (d < 6) v = (v << 1) | nx[d];
            }
            cur = nx;
            shifts.push(v % Charset.length);
        }
        return shifts;
    }

    function additiveShift(token, key, skip, encryptLen, encrypt) {
        if (!token) return token;
        const p = Math.max(0, Math.min(skip, token.length));
        const a = Math.max(0, Math.min(encryptLen, token.length - p));
        if (a === 0) return token;
        const mid = token.slice(p, p + a).split("");
        const shifts = generateShiftsCellular(key, mid.length);
        const n = Charset.length;
        for (let i = 0; i < mid.length; i++) {
            const x = charsetIndex(mid[i]);
            if (x === -1) continue;
            mid[i] = encrypt ? Charset[(x + shifts[i]) % n] : Charset[((x - shifts[i]) % n + n) % n];
        }
        return token.slice(0, p) + mid.join("") + token.slice(p + a);
    }

    function cryptCellular(token, key, skip, encryptLen, encrypt) {
        return additiveShift(token, key, skip, encryptLen, encrypt);
    }

    const SigninKey = "A18}xcv$I~@Q2L+3QeUqn78*Yub787M7G30,dib*O#^W4R]5WkAwt90+Eah909S9";
    const ReserveKey = "A18}xcv$I~@Q2L+3QeUqn78*Yub787M7G30,dib*O#^W4R]5WkAwt90+Eah909S9";

    const CipherManager = {
        _unifiedFn: null,
        _enabled: false,

        get enabled() { return this._enabled; },

        loadScript(scriptText) {
            if (!scriptText || !scriptText.trim()) {
                this._unifiedFn = null;
                this._enabled = false;
                return true;
            }
            try {
                const fn = new Function('rawToken', 'purpose', `
                    "use strict";
                    ${scriptText}
                    if (typeof encryptToken === 'function') return encryptToken(rawToken, purpose);
                    if (typeof ProcessToken === 'function') return ProcessToken(rawToken, purpose);
                    if (typeof encryptCaptchaToken === 'function') return encryptCaptchaToken(rawToken, purpose);
                    return rawToken;
                `);
               // fn('', '');
                this._unifiedFn = fn;
                this._enabled = true;
                return true;
            } catch (e) {
                console.error('[IVAC] Cipher script error:', e);
                this._unifiedFn = null;
                this._enabled = false;
                return false;
            }
        },

        processSignin(rawToken) {
            if (this._enabled && this._unifiedFn) {
                try {
                    return this._unifiedFn(rawToken, 'Signin');
                } catch (e) {
                    console.warn('[IVAC] Custom cipher error, fallback to hardcode');
                }
            }
            return cryptCellular(rawToken, SigninKey, 5, 18, true);
        },

        processReserve(rawToken) {
            if (this._enabled && this._unifiedFn) {
                try {
                    return this._unifiedFn(rawToken, 'Reserve');
                } catch (e) {
                    console.warn('[IVAC] Custom cipher error, fallback to hardcode');
                }
            }
            return cryptCellular(rawToken, ReserveKey, 5, 428, true);
        },

//  const CipherManager = {
    // ... other properties ...

    fetchFromServer() {
        return new Promise((resolve) => {
            const url = APIManager.get('cipherServer');
            console.log('[CIPHER] Fetching from:', url);

            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: {
                    'ngrok-skip-browser-warning': 'true',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Accept': 'application/json, text/plain, */*'
                },
                timeout: 8000,
                onload: (r) => {
                    console.log('[CIPHER] Response status:', r.status);
                    if (r.status >= 200 && r.status < 300 && r.responseText) {
                        console.log('[CIPHER] ✅ Script loaded successfully');
                        this.loadScript(r.responseText);
                        resolve(true);
                    } else {
                        console.log('[CIPHER] ❌ Bad response:', r.status);
                        resolve(false);
                    }
                },
                onerror: () => {
                    console.error('[CIPHER] ❌ Request error');
                    resolve(false);
                },
                ontimeout: () => {
                    console.error('[CIPHER] ❌ Timeout');
                    resolve(false);
                }
            });
        });
    }
};

    // ─── UTILITY HELPERS ─────────────────────────────────────────────
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function wordsToDigits(text) {
        const map = {
            zero: '0', one: '1', two: '2', three: '3', four: '4',
            five: '5', six: '6', seven: '7', eight: '8', nine: '9'
        };
        return text.toLowerCase().replace(/-/g, ' ').replace(
            /\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/g,
            m => map[m]
        );
    }

    function toBengaliDigits(text) {
        const map = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
                      '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
        return text.replace(/[০-৯]/g, d => map[d]);
    }

    function extractOtp(rawText) {
        const normalized = toBengaliDigits(rawText);
        let otp = '';
        try {
            const data = JSON.parse(normalized);
            const val = String(data.otp || data.code || data.sms || data.message || data.token || data.text || data.body || '');
            otp = wordsToDigits(toBengaliDigits(val)).replace(/\s+/g, '').replace(/\D/g, '').slice(0, 6);
            if (otp.length < 6) {
                const full = wordsToDigits(normalized).replace(/\s+/g, '');
                const cleaned = full.replace(/\d{11}/g, 'X');
                const match = cleaned.match(/\d{6}/);
                otp = match ? match[0] : '';
            }
        } catch {
            const converted = wordsToDigits(normalized).replace(/\s+/g, '');
            const cleaned = converted.replace(/\d{11}/g, 'X');
            const match = cleaned.match(/\d{6}/);
            otp = match ? match[0] : '';
        }
        return otp.length === 6 ? otp : '';
    }

    function setNativeValue(el, value) {
        const proto = el.tagName === 'INPUT' ? HTMLInputElement : HTMLTextAreaElement;
        const desc = Object.getOwnPropertyDescriptor(proto.prototype, 'value');
        desc.set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function addPressEffect(el) {
        if (!el) return;
        el.addEventListener('mousedown', () => {
            el.style.filter = 'brightness(0.85)';
            el.style.transform = 'scale(0.98)';
        });
        el.addEventListener('mouseup', () => {
            el.style.filter = '';
            el.style.transform = '';
        });
        el.addEventListener('mouseleave', () => {
            el.style.filter = '';
            el.style.transform = '';
        });
    }

    function gmFetch(url) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    onload: r => resolve(r.responseText),
                    onerror: reject
                });
            } else {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', url);
                xhr.onload = () => resolve(xhr.responseText);
                xhr.onerror = () => reject(new Error('XHR failed'));
                xhr.send();
            }
        });
    }

    // ─── EXPOSE GLOBALLY ────────────────────────────────────────────
    window._ivacAPIS = APIManager.getAll();
    window._apiUrl = (key) => APIManager.get(key);
    window._resetApiConfig = () => APIManager.reset();
    window._IVAC_API_DEFAULTS = IVAC_API_DEFAULTS;
    window._IVAC_API_LABELS = IVAC_API_LABELS;
    window._ivacSharedProfile = SharedProfile;
    window.EnhancedDynamicApiManager = EnhancedDynamicApiManager;
    window.initEnhancedDynamicApiManager = initEnhancedDynamicApiManager;
    window.callDynamicAPI = callDynamicAPI;

    // Initialize token pool
    TokenPoolManager.init();

    console.log('[IVAC] Enhanced Dynamic API loaded successfully!');

    // ================================================================
    // 🎯 PART 4: SHELL STYLES & DRAG
    // ================================================================

    const shellStyle = document.createElement('style');
    shellStyle.id = 'ivac-combined-shell-style';
    shellStyle.textContent = `
        #ivac-combined-shell {
            position: fixed; top: 20px; right: 20px; z-index: 99999;
            width: 330px; max-width: calc(100vw - 20px);
            background: #ffffff; border-radius: 4px; border: 1px solid #e2e8f0;
            box-shadow: 0 20px 25px -5px rgba(0,0,0,0.15), 0 10px 10px -5px rgba(0,0,0,0.04);
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            overflow: hidden; display: flex; flex-direction: column;
        }
        #ivac-combined-tabs {
            display: flex; background: #f1f5f9; border-bottom: 1px solid #e2e8f0;
            user-select: none; flex-shrink: 0;
        }
        #ivac-combined-tabs button {
            flex: 1; padding: 3px 3px; border: none; background: transparent;
            font-size: 11px; font-weight: 700; color: #64748b; cursor: pointer;
            transition: all .15s;
        }
        #ivac-combined-tabs button:hover { background: #e2e8f0; }
        #ivac-combined-tabs button.ivac-tab-active {
            color: #0f172a; background: #ffffff; box-shadow: inset 0 -2px 0 #2563eb;
        }
        #ivac-combined-minbtn { flex: 0 0 32px !important; font-size: 14px !important; font-weight: 700 !important; }
        #ivac-combined-body { padding: 10px; max-height: 85vh; overflow-y: auto; box-sizing: border-box; }
        #ivac-combined-body.ivac-collapsed { display: none; }
        .ivac-tab-panel { display: none; }
        .ivac-tab-panel.ivac-tab-panel-active { display: block; }

        .dapi-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 8px;
            margin: 8px 0;
            background: #f0fdf4;
            border: 1px solid #86efac;
            border-radius: 4px;
        }
        .dapi-row .dapi-label {
            font-size: 10px;
            font-weight: 700;
            white-space: nowrap;
            width: 75px;
            flex-shrink: 0;
            text-align: left;
            border: 1px solid #bfdbfe;
            border-radius: 4px;
            padding: 4px 6px;
            background: #eff6fe;
            color: #0369a1;
            box-sizing: border-box;
        }
        .dapi-row .dapi-input {
            flex: 1;
            height: 28px;
            padding: 0 8px;
            font-size: 10px;
            font-family: monospace;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            outline: none;
            box-sizing: border-box;
            color: #1e293b;
            background: #f8fafc;
        }
        .dapi-row .dapi-input:focus {
            border-color: #22c55e;
            box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.1);
        }
        .dapi-row .dapi-fetch-btn {
            height: 28px;
            padding: 0 12px;
            background: #7c3aed;
            color: #fff;
            border: none;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 700;
            cursor: pointer;
            flex-shrink: 0;
            transition: all 0.15s ease;
        }
        .dapi-row .dapi-fetch-btn:hover {
            background: #6d28d9;
            transform: scale(1.02);
        }
        .dapi-row .dapi-fetch-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        .dapi-row .dapi-status {
            font-size: 9px;
            color: #94a3b8;
            min-width: 50px;
            text-align: right;
        }
        .dapi-row .dapi-status.ok { color: #22c55e; }
        .dapi-row .dapi-status.error { color: #ef4444; }
        .dapi-row .dapi-status.loading { color: #f59e0b; }

        #sb-api-modal-slotbd {
            display: none;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 310px;
            max-height: 90vh;
            background: #ffffff;
            z-index: 2147483647;
            padding: 10px;
            overflow-y: auto;
            box-sizing: border-box;
            border-radius: 4px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.25);
            border: 1px solid #e2e8f0;
            font-family: system-ui, sans-serif;
        }
        #sb-api-modal-slotbd .api-tab {
            flex: 1;
            padding: 8px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            font-size: 12px;
            transition: all 0.2s;
        }
        #sb-api-modal-slotbd .api-tab.active {
            background: #22c55e;
            color: #ffffff;
        }
        #sb-api-modal-slotbd .api-tab:not(.active) {
            background: #e2e8f0;
            color: #1e293b;
        }
        #sb-api-modal-slotbd .api-tab-content {
            display: none;
        }
        #sb-api-modal-slotbd .api-tab-content.active {
            display: block;
        }
        #sb-api-modal-slotbd textarea {
            width: 100%;
            min-height: 120px;
            padding: 8px;
            font-family: monospace;
            font-size: 11px;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            box-sizing: border-box;
            resize: vertical;
        }
        #sb-api-detected-list {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px;
            max-height: 150px;
            overflow-y: auto;
        }
        #sb-api-detected-list::-webkit-scrollbar {
            width: 3px;
        }
        #sb-api-detected-list::-webkit-scrollbar-thumb {
            background: #d1d5db;
            border-radius: 4px;
        }
        #sb-api-detection-status {
            display: none;
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
            font-size: 11px;
            line-height: 1.5;
        }
        #sb-api-info {
            padding: 10px;
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            border-radius: 4px;
            font-size: 10px;
            color: #0369a1;
            line-height: 1.6;
            max-height: 100px;
            overflow-y: auto;
        }
        .endpoint-detail {
            font-size: 9px;
            color: #64748b;
            margin-top: 2px;
        }
        .endpoint-detail .badge-header {
            display: inline-block;
            background: #e0e7ff;
            color: #4338ca;
            padding: 0 6px;
            border-radius: 4px;
            font-size: 8px;
            font-weight: 700;
        }
        .endpoint-detail .badge-payload {
            display: inline-block;
            background: #fce7f3;
            color: #be185d;
            padding: 0 6px;
            border-radius: 4px;
            font-size: 8px;
            font-weight: 700;
        }
    `;
    document.head.appendChild(shellStyle);

  // ─── SHELL DOM ──────────────────────────────────────────────────
    const shell = document.createElement('div');
    shell.id = 'ivac-combined-shell';

    const tabs = document.createElement('div');
    tabs.id = 'ivac-combined-tabs';

    const tabBtnSlotBD = document.createElement('button');
    tabBtnSlotBD.textContent = 'Dynamic';
    tabBtnSlotBD.className = 'ivac-tab-active';

    // Upload বাটন ডিলিট করা হয়েছে

    const tabBtnReserve = document.createElement('button');
    tabBtnReserve.textContent = 'Manual';

    const minBtn = document.createElement('button');
    minBtn.id = 'ivac-combined-minbtn';
    minBtn.textContent = '−';
    minBtn.title = 'Minimize / Expand';

    tabs.appendChild(tabBtnSlotBD);
    tabs.appendChild(tabBtnReserve);
    tabs.appendChild(minBtn);

    const body = document.createElement('div');
    body.id = 'ivac-combined-body';

    const panelSlotBD = document.createElement('div');
    panelSlotBD.id = 'ivac-tab-slotbd-wrap';
    panelSlotBD.className = 'ivac-tab-panel';

    // Upload প্যানেল ডিলিট করা হয়েছে

    const panelReserve = document.createElement('div');
    panelReserve.id = 'ivac-tab-reserve';
    panelReserve.className = 'ivac-tab-panel ivac-tab-panel-active';

    body.appendChild(panelSlotBD);
    body.appendChild(panelReserve);

    // ── Global Profile Card ──────────────────────
    const globalProfileCard = document.createElement('div');
    globalProfileCard.id = 'global-profile-card';
    globalProfileCard.style.cssText = 'display:flex; position:sticky; top:0; left:0; right:0; z-index:999; background:linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-bottom:2px solid #86efac; padding:8px 12px; letter-spacing: 2px; margin:-8px -8px 8px -8px';
    globalProfileCard.innerHTML = `
        <div style="display: flex; flex-direction: row; align-items: center; gap: 10px; white-space: nowrap;">
            <span style="font-size: 25px;">🗣️</span>
            <div id="global-profile-name" style="font-size: 12px; font-weight: 700; color: #0f172a;"></div>
            <div id="global-profile-phone" style="font-size: 15px; color: #475569; font-family: monospace; font-weight: 900;"></div>
        </div>
    `;
    shell.appendChild(globalProfileCard);

    shell.appendChild(tabs);
    shell.appendChild(body);
    document.body.appendChild(shell);

    // ─── DRAG ──────────────────────────────────────────────────────
    function makeDraggable(draggableElement) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        draggableElement.style.cursor = 'move';

        draggableElement.addEventListener('mousedown', function(e) {
            const targetTag = e.target.tagName.toLowerCase();
            if (['button', 'input', 'textarea', 'select', 'label'].includes(targetTag)) {
                return;
            }
            e.preventDefault();
            const rect = draggableElement.getBoundingClientRect();
            draggableElement.style.bottom = 'auto';
            draggableElement.style.right = 'auto';
            draggableElement.style.transform = 'none';
            draggableElement.style.margin = '0';
            draggableElement.style.left = rect.left + 'px';
            draggableElement.style.top = rect.top + 'px';

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = rect.left;
            initialTop = rect.top;

            window.addEventListener('mousemove', elementDrag, { passive: false });
            window.addEventListener('mouseup', closeDragElement);
        });

        function elementDrag(e) {
            if (!isDragging) return;
            e.preventDefault();
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            draggableElement.style.left = (initialLeft + dx) + 'px';
            draggableElement.style.top = (initialTop + dy) + 'px';
        }

        function closeDragElement() {
            if (!isDragging) return;
            isDragging = false;
            window.removeEventListener('mousemove', elementDrag);
            window.removeEventListener('mouseup', closeDragElement);
        }
    }

    makeDraggable(shell);

    // ─── TAB SWITCHING ────────────────────────────────────────────
    function activate(tab) {
        const isSlotBD = tab === 'slotbd';
        const isReserve = tab === 'reserve';

        tabBtnSlotBD.classList.toggle('ivac-tab-active', isSlotBD);
        tabBtnReserve.classList.toggle('ivac-tab-active', isReserve);

        panelSlotBD.classList.toggle('ivac-tab-panel-active', isSlotBD);
        panelReserve.classList.toggle('ivac-tab-panel-active', isReserve);
        try { localStorage.setItem('ivac-active-tab', tab); } catch(e) {}
    }

    tabBtnSlotBD.onclick = () => activate('slotbd');
    tabBtnReserve.onclick = () => activate('reserve');

    let collapsed = false;
    minBtn.onclick = () => {
        collapsed = !collapsed;
        body.classList.toggle('ivac-collapsed', collapsed);
        minBtn.textContent = collapsed ? '+' : '−';
    };

    const lastTab = (() => { try { return localStorage.getItem('ivac-active-tab') || 'slotbd'; } catch(e) { return 'slotbd'; } })();
    activate(lastTab);

    // ─── INIT TABS ────────────────────────────────────────────────
    runSlotBDTab(panelSlotBD);
    runUploadTab(panelSlotBD); // <-- আপলোডের ফাংশনটি এখন SlotBD প্যানেলেই রান হবে
    runReserveTab(panelReserve);



        // ===== UI ONLY: upload panel কে Manual tab-এর ভিতরে নিয়ে যাওয়া =====
    (function mountUploadPanelInManual() {
        let tries = 0;
        const MAX_TRIES = 200; // প্রায় ২০ সেকেন্ড চেষ্টা করবে

        const timer = setInterval(() => {
            tries++;
            const reserveTab = document.getElementById('ivac-tab-reserve');
            const uploadPanel = document.getElementById('ivac-auto-panel');

            if (reserveTab && uploadPanel) {
                clearInterval(timer);

                // ১. element সরানো (ID ও event listener ঠিক থাকবে)
                reserveTab.appendChild(uploadPanel);

                // ২. floating panel থেকে embedded block-এ রূপান্তর
                Object.assign(uploadPanel.style, {
                    position: 'static',
                    top: '',
                    right: '',
                    width: '100%',
                    zIndex: '',
                    boxShadow: 'none',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    marginTop: '8px'
                });

                // ৩. panel আর floating না থাকায় drag করে সরানো বন্ধ
                reserveTab.addEventListener('pointerdown', (e) => {
                    if (e.target.closest('#ivac-auto-panel')) {
                        e.stopPropagation();
                    }
                }, true);

                console.log('[UI] Upload panel mounted in Manual tab');
            } else if (tries >= MAX_TRIES) {
                clearInterval(timer);
            }
        }, 100);
    })();



    // ================================================================
    // 🎯 PART 5: RESERVE TAB (Manual)
    // ================================================================

    function runReserveTab(mountEl) {
        'use strict';

        const apiUrl = (key) => APIManager.get(key);

        function loadProfiles() {
            try {
                return JSON.parse(GM_getValue('ivac_profiles', '[]')) || [];
            } catch { return []; }
        }

        function saveProfiles(list) {
            GM_setValue('ivac_profiles', JSON.stringify(list));
        }

        function getLastIdx() {
            return GM_getValue('ivac_last_profile', '');
        }

        function setLastIdx(v) {
            GM_setValue('ivac_last_profile', String(v));
        }

        let savedProfiles = loadProfiles();
        let PHONE = SharedProfile.phone || GM_getValue('ivac_phone', '');
        let PASSWORD = SharedProfile.password || GM_getValue('ivac_password', '');

        SharedProfile.onChange((ph, pw) => {
            PHONE = ph;
            PASSWORD = pw;
            const phoneEl = document.getElementById('reserve-phone-input');
            const passEl = document.getElementById('reserve-pass-input');
            if (phoneEl) phoneEl.value = ph;
            if (passEl) passEl.value = pw;
        });

        const OTP_API = () => `${apiUrl('otpPoller')}?phone=${PHONE}`;

        let otpPoller = null;

        let otpAutoDone = false;
        let otpPageDetected = false;

        let capturedXToken = GM_getValue('ivac_x_token', '');
        let capturedXTokenTime = parseInt(GM_getValue('ivac_x_token_time', '0'), 10) || 0;
        let turnstileWidgetId = null;

        // ── Panel UI ──────────────────────────────────────────────
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            position: 'relative',
            background: 'transparent',
            borderRadius: '0',
            padding: '0',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            boxShadow: 'none',
            fontFamily: 'system-ui, sans-serif',
            width: '100%',
            boxSizing: 'border-box',
            border: 'none'
        });

        const LEFT_WIDTH = '60px', RIGHT_WIDTH = '60px';

        // ── Profile row ──────────────────────────────────────────
        const row0 = document.createElement('div');
        Object.assign(row0.style, { display: 'flex', gap: '6px', alignItems: 'center' });

        const profileSelect = document.createElement('select');
        profileSelect.id = 'manual-profile-select';
        Object.assign(profileSelect.style, {
            flex: '1', padding: '8px 12px', borderRadius: '8px',
            border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '500',
            background: '#f8fafc', color: '#0f172a', outline: 'none',
            cursor: 'pointer', minWidth: '0', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)'
        });

        const settingsBtn = document.createElement('button');
        settingsBtn.innerHTML = '👤';
        Object.assign(settingsBtn.style, {
            width: '40px', height: '34px', boxSizing: 'border-box',
            padding: '0', background: '#f1f5f9', border: '1px solid #cbd5e1',
            borderRadius: '4px', fontSize: '15px', cursor: 'pointer',
            textAlign: 'center', flexShrink: '0'
        });

        row0.appendChild(profileSelect);
        row0.appendChild(settingsBtn);

        // ── Settings Modal ──────────────────────────────────────
        const modal = document.createElement('div');
        Object.assign(modal.style, {
            display: 'none', position: 'fixed', bottom: '50%', right: '50%',
            zIndex: '999999', background: '#fff', border: '1px solid #e2e8f0',
            borderRadius: '4px', padding: '14px', width: '330px',
            boxSizing: 'border-box', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)',
            fontFamily: 'system-ui, sans-serif', flexDirection: 'column', gap: '8px'
        });

        const modalTitle = document.createElement('div');
        Object.assign(modalTitle.style, {
            fontSize: '13px', fontWeight: '700', color: '#0f172a',
            borderBottom: '1px solid #e2e8f0', paddingBottom: '8px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        });
        modalTitle.innerHTML = '<span>⚙️ Profile Settings</span>';

        const closeModalBtn = document.createElement('button');
        closeModalBtn.textContent = '✕';
        Object.assign(closeModalBtn.style, {
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '14px', color: '#94a3b8', fontWeight: '700'
        });
        modalTitle.appendChild(closeModalBtn);

        const modalTopRow = document.createElement('div');
        Object.assign(modalTopRow.style, { display: 'flex', gap: '6px', alignItems: 'center' });

        const modalProfileSelect = document.createElement('select');
        Object.assign(modalProfileSelect.style, {
            flex: '1', padding: '6px 10px', borderRadius: '4px',
            border: '1px solid #cbd5e1', fontSize: '12px',
            background: '#f8fafc', color: '#0f172a', outline: 'none',
            cursor: 'pointer', minWidth: '0'
        });

        function iconBtn(svgPath, title) {
            const b = document.createElement('button');
            b.innerHTML = svgPath;
            b.title = title;
            Object.assign(b.style, {
                width: '32px', height: '29px', padding: '0',
                background: '#16a34a', color: '#ffffff',
                border: '1px solid #334155', borderRadius: '6px',
                fontSize: '13px', cursor: 'pointer', flexShrink: '0',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            });
            return b;
        }

        const exportBtn = iconBtn(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M3 21h18"/></svg>`, 'Export JSON');
        const importBtn = iconBtn(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v12"/><path d="m7 14 5-5 5 5"/><path d="M3 3h18"/></svg>`, 'Import JSON');

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';

        modalTopRow.appendChild(modalProfileSelect);
        modalTopRow.appendChild(exportBtn);
        modalTopRow.appendChild(importBtn);
        modalTopRow.appendChild(fileInput);

        function textInput(placeholder, w) {
            const inp = document.createElement('input');
            inp.placeholder = placeholder;
            Object.assign(inp.style, {
                padding: '6px 8px', borderRadius: '6px',
                border: '1px solid #cbd5e1', fontSize: '12px',
                background: '#f8fafc', color: '#0f172a', outline: 'none',
                minWidth: '0', ...(w ? { width: w, flexShrink: '0' } : { flex: '1' })
            });
            return inp;
        }

        const formRow0 = document.createElement('div');
        Object.assign(formRow0.style, { display: 'flex', gap: '6px' });
        const modalName = textInput('Buyer Name', '90px');

        const modalType = document.createElement('select');
        Object.assign(modalType.style, {
            flex: '1', padding: '6px 4px', borderRadius: '6px',
            border: '1px solid #cbd5e1', fontSize: '12px',
            background: '#f8fafc', color: '#0f172a', outline: 'none',
            cursor: 'pointer', minWidth: '0'
        });
        const typeDefaultOpt = document.createElement('option');
        typeDefaultOpt.value = '';
        typeDefaultOpt.textContent = 'Visa Type';
        typeDefaultOpt.disabled = true;
        typeDefaultOpt.selected = true;
        modalType.appendChild(typeDefaultOpt);
        [['Tourist', 'Tourist'], ['Medical', 'Medical'], ['Double Entry', 'Double Entry'],
         ['Business', 'Business'], ['Student', 'Student']]
        .forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            modalType.appendChild(opt);
        });

        const modalCount = document.createElement('select');
        Object.assign(modalCount.style, {
            width: '75px', padding: '6px 4px', borderRadius: '6px',
            border: '1px solid #cbd5e1', fontSize: '12px',
            background: '#f8fafc', color: '#0f172a', outline: 'none',
            cursor: 'pointer', flexShrink: '0'
        });
        [['1', '1 BGD'], ['2', '2 BGD'], ['3', '3 BGD'], ['4', '4 BGD']]
        .forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            modalCount.appendChild(opt);
        });

        formRow0.appendChild(modalName);
        formRow0.appendChild(modalType);
        formRow0.appendChild(modalCount);

        const formRow1 = document.createElement('div');
        Object.assign(formRow1.style, { display: 'flex', gap: '6px' });
        const modalPhone = textInput('Phone');
        modalPhone.maxLength = 11;
        modalPhone.inputMode = 'numeric';
        modalPhone.addEventListener('input', () => {
            modalPhone.value = modalPhone.value.replace(/\D/g, '').slice(0, 11);
        });
        const modalPass = textInput('Password');
        modalPass.addEventListener('input', () => {
            modalPass.value = modalPass.value.replace(/\s/g, '');
        });
        formRow1.appendChild(modalPhone);
        formRow1.appendChild(modalPass);

        function actionBtn(text, bg, color, border) {
            const b = document.createElement('button');
            b.textContent = text;
            Object.assign(b.style, {
                flex: '1', padding: '8px', background: bg, color,
                border, borderRadius: '6px', fontWeight: '600',
                fontSize: '12px', cursor: 'pointer'
            });
            return b;
        }

        const formRow2 = document.createElement('div');
        Object.assign(formRow2.style, { display: 'flex', gap: '6px' });
        const modalSaveBtn = actionBtn('💾 Save', '#FF671F', '#fff', 'none');
        const modalDelBtn = actionBtn('🗑 Delete', '#fef2f2', '#dc2626', '1px solid #fca5a5');
        const modalClearBtn = actionBtn('🗑 Clear All', '#7f1d1d', '#fca5a5', '1px solid #fca5a5');
        formRow2.appendChild(modalSaveBtn);
        formRow2.appendChild(modalDelBtn);
        formRow2.appendChild(modalClearBtn);

        modal.appendChild(modalTitle);
        modal.appendChild(modalTopRow);


            /***************************************************************
     * PRIMARY PDF AUTOFILL — নাম, ফোন, Visa Type, ২৯ দিনের হিসাব
     ***************************************************************/
    const PDF_MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
    const PDF_MONTH_NAMES = Object.keys(PDF_MONTHS);
    const PDF_DATE_RE = /(\d{2})-([A-Z]{3})-(\d{4})/i;
    const PDF_WINDOW_DAYS = 29;
    const PDF_DAY_MS = 86400000;
    const PDF_VISA_OPTIONS = ['Tourist', 'Medical', 'Double Entry', 'Business', 'Student'];

    function pdfParseDate(text) {
        const m = PDF_DATE_RE.exec(text || '');
        if (!m) return null;
        const month = PDF_MONTHS[m[2].toUpperCase()];
        if (month === undefined) return null;
        return new Date(Number(m[3]), month, Number(m[1]));
    }

    function pdfFormatDate(d) {
        return String(d.getDate()).padStart(2, '0') + '-' + PDF_MONTH_NAMES[d.getMonth()] + '-' + d.getFullYear();
    }

    async function pdfInflate(bytes) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    async function pdfExtractTokens(buffer) {
        const bytes = new Uint8Array(buffer);
        const raw = new TextDecoder('latin1').decode(bytes);
        const tokens = [];
        const streamRe = /(?<!end)stream\r?\n/g;
        let m;
        while ((m = streamRe.exec(raw))) {
            const start = m.index + m[0].length;
            const endstreamAt = raw.indexOf('endstream', start);
            if (endstreamAt < 0) continue;

            // /Length থেকে সঠিক শেষ বের করা (trailing junk এড়াতে)
            let end = endstreamAt;
            const dict = raw.slice(Math.max(0, m.index - 400), m.index);
            const lenRe = /\/Length\s+(\d+)(?!\s+\d+\s+R)/g;
            let lm, lastLen = null;
            while ((lm = lenRe.exec(dict))) lastLen = Number(lm[1]);
            if (lastLen !== null && start + lastLen <= endstreamAt) {
                end = start + lastLen;
            } else {
                while (end > start && /[\r\n ]/.test(raw[end - 1])) end--;
            }

            let text;
            try {
                text = new TextDecoder('latin1').decode(await pdfInflate(bytes.subarray(start, end)));
            } catch (e) {
                text = raw.slice(start, end);
            }

            const strRe = /\(((?:\\.|[^\\()])*)\)/g;
            let s;
            while ((s = strRe.exec(text))) {
                const value = s[1].replace(/\\(.)/g, '$1').trim();
                if (value) tokens.push(value);
            }
        }
        return tokens;
    }

    function pdfValueAfter(tokens, label, ahead) {
        ahead = ahead || 4;
        const L = label.toLowerCase();
        const i = tokens.findIndex(t => t.toLowerCase().includes(L));
        if (i < 0) return '';
        for (let j = i + 1; j <= i + ahead && j < tokens.length; j++) {
            const t = tokens[j];
            if (t.length > 1 && !/[()]/.test(t) && !/:$/.test(t)) return t;
        }
        return '';
    }

    function pdfDateAfter(tokens, label) {
        const L = label.toLowerCase();
        const i = tokens.findIndex(t => t.toLowerCase().includes(L));
        if (i < 0) return '';
        for (let j = i; j <= i + 5 && j < tokens.length; j++) {
            const m = PDF_DATE_RE.exec(tokens[j]);
            if (m) return m[0].toUpperCase();
        }
        return '';
    }

    function pdfExtractInfo(tokens) {
        const surname = pdfValueAfter(tokens, 'Surname');
        const given = pdfValueAfter(tokens, 'Given Name');
        return {
            name: [given, surname].filter(Boolean).join(' '),
            phone: pdfValueAfter(tokens, 'Phone No').replace(/\D/g, ''),
            visa: pdfValueAfter(tokens, 'Type Of Visa Required'),
            regText: pdfDateAfter(tokens, 'Registration Date'),

        };
    }

    function pdfVisaOption(visaText) {
        const up = (visaText || '').toUpperCase();
        return PDF_VISA_OPTIONS.find(o => up.includes(o.toUpperCase())) || '';
    }

    function pdfRemaining(regDate, today) {
        const deadline = new Date(regDate.getFullYear(), regDate.getMonth(), regDate.getDate() + PDF_WINDOW_DAYS);
        const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        return { deadline, left: Math.round((deadline - t) / PDF_DAY_MS) };
    }


           function pdfDisplayLabel(info) {
        const reg = pdfParseDate(info.regText);
        const name = info.name || '';
        if (!reg) return name || null;
        const left = pdfRemaining(reg, new Date()).left;
        const dayText = left >= 0 ? `${left}` : 'Expired';
        return name ? `(${dayText}) - ${name}` : dayText;
    }

    async function pdfLabelFromFile(file) {
        const info = pdfExtractInfo(await pdfExtractTokens(await file.arrayBuffer()));
        return pdfDisplayLabel(info);
    }

    window._ivacPdfLabel = pdfLabelFromFile;

            const PDF_VISA_KEY = 'ivac_visa_custom';

    // "TOURIST VISA" → "Tourist", "TRANSIT VISA" → "Transit"
    function pdfVisaLabelFromText(text) {
        const t = (text || '').replace(/\s+/g, ' ').trim()
            .replace(/\s*VISA\s*$/i, '').trim();
        if (!t) return '';
        return t.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

    function isBaseVisa(label) {
        return PDF_VISA_OPTIONS.some(o => o.toLowerCase() === label.toLowerCase());
    }

    function saveCustomVisa(label) {
        if (isBaseVisa(label)) return;
        try {
            const list = JSON.parse(GM_getValue(PDF_VISA_KEY, '[]')) || [];
            if (!list.some(v => v.toLowerCase() === label.toLowerCase())) {
                list.push(label);
                GM_setValue(PDF_VISA_KEY, JSON.stringify(list));
            }
        } catch (e) {}
    }

    // dropdown-এ না থাকলে option যোগ করে, আসল value ফেরত দেয়
    function addVisaOption(label) {
        if (!label) return '';
        const found = Array.from(modalType.options)
            .find(o => o.value.toLowerCase() === label.toLowerCase());
        if (found) return found.value;
        const opt = document.createElement('option');
        opt.value = label;
        opt.textContent = label;
        modalType.appendChild(opt);
        return label;
    }

    function ensureVisaOption(label) {
        const val = addVisaOption(label);
        saveCustomVisa(val);
        return val;
    }

    // আগের সেভ করা custom visa type গুলো dropdown-এ ফিরিয়ে আনে
    function loadCustomVisaOptions() {
        try {
            const list = JSON.parse(GM_getValue(PDF_VISA_KEY, '[]')) || [];
            list.forEach(v => addVisaOption(v));
        } catch (e) {}
    }
    loadCustomVisaOptions();


    const pdfInfoBox = document.createElement('div');
    Object.assign(pdfInfoBox.style, {
        display: 'none',
        whiteSpace: 'pre-line',
        fontSize: '11px',
        lineHeight: '1.6',
        fontWeight: '600',
        padding: '7px 9px',
        marginTop: '2px',
        borderRadius: '6px',
        background: '#f0f9ff',
        border: '1px solid #bae6fd',
        boxSizing: 'border-box'
    });

       function showPdfInfo(text, color) {
        pdfInfoBox.style.display = 'none';
    }

    async function pdfAutoFill(file) {
        try {
            const tokens = await pdfExtractTokens(await file.arrayBuffer());
            const info = pdfExtractInfo(tokens);
            const lines = [];
            let color = '#1e3a8a';

                        const primaryLabel = pdfDisplayLabel(info);
            if (primaryLabel) setPdfLabel('patent', primaryLabel, 'new');
            lines.push('👤 ' + (info.name || 'নাম পাওয়া যায়নি'));

            if (info.phone) modalPhone.value = info.phone;
            lines.push('📞 ' + (info.phone || 'ফোন পাওয়া যায়নি'));

                        const visa = ensureVisaOption(pdfVisaLabelFromText(info.visa));
            if (visa) modalType.value = visa;
            lines.push('🛂 ' + (info.visa || 'Visa type পাওয়া যায়নি') + (visa ? ' → ' + visa : ''));


            const reg = pdfParseDate(info.regText);
            if (reg) {
                const { deadline, left } = pdfRemaining(reg, new Date());
                lines.push('📅 Reg ' + info.regText + ' → শেষ ' + pdfFormatDate(deadline));
                if (left >= 0) {
                    lines.push('⏳ বাকি ' + left + ' দিন');
                    color = '#07883c';
                } else {
                    lines.push('❌ মেয়াদ শেষ, ' + Math.abs(left) + ' দিন আগে');
                    color = '#b91c1c';
                }
                const journey = pdfParseDate(info.journeyText);
                if (journey && journey > deadline) {
                    lines.push('⚠ Journey ' + info.journeyText + ' → ২৯ দিনের বাইরে');
                    color = '#b91c1c';
                }
            } else {
                lines.push('📅 Registration date পড়া যায়নি');
                color = '#b91c1c';
            }

            showPdfInfo(lines.join('\n'), color);
        } catch (err) {
            console.error('[KAFALA PDF ERROR]', err);
            showPdfInfo('PDF পড়তে সমস্যা হয়েছে', '#b91c1c');
        }
    }



     // ── PDF rows: vertical, professional card layout ──────────────────
// modalPdfStage: undefined = বদলায়নি, null = মুছবে, File = নতুন ফাইল
const modalPdfStage = {};
const PDF_SLOT_DEFS = [
    { slot: 'patent',  tag: 'Primary' },
    { slot: 'attend1', tag: 'Secondary 1' },
    { slot: 'attend2', tag: 'Secondary 2' },
    { slot: 'attend3', tag: 'Secondary 3' }
];

const PDF_ICON_SVG = '<svg width="14" height="14"';

const PDF_STATE_STYLES = {
    empty:    { text: '#94a3b8', weight: '500', italic: 'italic', border: '#cbd5e1', dash: 'dashed', bg: '#f8fafc' },
    existing: { text: '#0f172a', weight: '500', italic: 'normal', border: '#e2e8f0', dash: 'solid',  bg: '#ffffff' },
    new:      { text: '#1d4ed8', weight: '600', italic: 'normal', border: '#93c5fd', dash: 'solid',  bg: '#eff6ff' },
    removed:  { text: '#dc2626', weight: '500', italic: 'italic', border: '#fecaca', dash: 'dashed', bg: '#fef2f2' }
};

const pdfRow = document.createElement('div');
Object.assign(pdfRow.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%'
});

const pdfSlotLabels = {};
const pdfSlotCards = {};

// state: 'empty' | 'existing' | 'new' | 'removed'
// পুরোনো কল setPdfLabel(slot, text, true/false) এও কাজ করবে
function setPdfLabel(slot, text, state) {
    if (state === true) state = 'new';
    else if (state === false || state === undefined || state === null) state = 'existing';

    const el = pdfSlotLabels[slot];
    const card = pdfSlotCards[slot];
    if (!el || !card) return;

    const s = PDF_STATE_STYLES[state] || PDF_STATE_STYLES.existing;

    el.textContent = text;
    el.title = text;
    el.style.color = s.text;
    el.style.fontWeight = s.weight;
    el.style.textAlign = 'left';

    card.style.borderColor = s.border;
    card.style.borderStyle = s.dash;
        card.style.background = s.bg;
    syncPdfCount();
}

        function handleSingleFile(slot, f) {
    if (f.type !== 'application/pdf') {
        setStatus('PDF only', '#f87171');
        setTimeout(() => setStatus(''), 2000);
        return;
    }
    modalPdfStage[slot] = f;
    setPdfLabel(slot, f.name, 'new');
    if (slot === 'patent') {
        pdfAutoFill(f);
    } else {
        pdfLabelFromFile(f)
            .then(lbl => { if (lbl) setPdfLabel(slot, lbl, 'new'); })
            .catch(() => {});
    }
}

const SECONDARY_SLOTS = ['attend1', 'attend2', 'attend3'];

function assignSecondaryFiles(startSlot, files) {
    const pdfs = files.filter(f => f.type === 'application/pdf');
    if (!pdfs.length) {
        setStatus('PDF only', '#f87171');
        setTimeout(() => setStatus(''), 2000);
        return;
    }
    let idx = SECONDARY_SLOTS.indexOf(startSlot);
    if (idx < 0) idx = 0;
    const targets = SECONDARY_SLOTS.slice(idx);
    const count = Math.min(pdfs.length, targets.length);
    for (let i = 0; i < count; i++) handleSingleFile(targets[i], pdfs[i]);
    if (pdfs.length > targets.length) {
        setStatus(`${pdfs.length - targets.length}টি ফাইল বাদ (S3 পর্যন্ত)`, '#cc7900');
        setTimeout(() => setStatus(''), 2500);
    }
}

function syncPdfCount() {
    const filled = PDF_SLOT_DEFS.filter(({ slot }) => {
        const el = pdfSlotLabels[slot];
        if (!el) return false;
        const t = el.textContent || '';
        return t !== '' && t !== 'Select PDF' && !t.startsWith('—');
    }).length;
    modalCount.value = String(Math.min(4, Math.max(1, filled)));
}



PDF_SLOT_DEFS.forEach(({ slot, tag }) => {
    const isPrimary = slot === 'patent';

    // Card
    const card = document.createElement('div');
    Object.assign(card.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: '4px',
        border: '1px solid #e2e8f0',
        background: '#ffffff',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        transition: 'box-shadow .15s, border-color .15s'
    });
    card.addEventListener('mouseenter', () => {
        card.style.boxShadow = '0 3px 8px rgba(15,23,42,0.08)';
    });
    card.addEventListener('mouseleave', () => {
        card.style.boxShadow = '0 1px 2px rgba(15,23,42,0.04)';
    });

    // Tag badge
    const badge = document.createElement('span');
    badge.textContent = tag;
    Object.assign(badge.style, {
        flexShrink: '0',
        fontSize: '10px',
        fontWeight: '700',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        padding: '3px 8px',
        borderRadius: '999px',
        background: isPrimary ? '#0f172a' : '#e2e8f0',
        color: isPrimary ? '#ffffff' : '#334155'
    });

    // File icon
    const icon = document.createElement('span');
    icon.innerHTML = PDF_ICON_SVG;
    Object.assign(icon.style, {
        display: 'flex',
        flexShrink: '0',
        color: '#64748b'
    });

    // Name (click to pick file)
    const nameEl = document.createElement('div');
    Object.assign(nameEl.style, {
        flex: '1',
        minWidth: '0',
        fontSize: '12px',
        cursor: 'pointer',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
    });

    // Remove button
    const clrBtn = document.createElement('button');
    clrBtn.type = 'button';
    clrBtn.textContent = '𝕏';
    clrBtn.title = 'Remove this PDF from profile';
    Object.assign(clrBtn.style, {
        flexShrink: '0',
        width: '22px',
        height: '22px',
        borderRadius: '50%',
        border: 'none',
        background: 'transparent',
        color: '#94a3b8',
        fontSize: '11px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background .15s, color .15s'
    });
    clrBtn.addEventListener('mouseenter', () => {
        clrBtn.style.background = '#fee2e2';
        clrBtn.style.color = '#dc2626';
    });
    clrBtn.addEventListener('mouseleave', () => {
        clrBtn.style.background = 'transparent';
        clrBtn.style.color = '#94a3b8';
    });

       // Hidden file input
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/pdf';
    inp.multiple = !isPrimary;
    inp.style.display = 'none';

    nameEl.addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => {
        const files = Array.from(inp.files || []);
        inp.value = '';
        if (!files.length) return;
        if (isPrimary) {
            handleSingleFile('patent', files[0]);
        } else {
            assignSecondaryFiles(slot, files);
        }
    });

    clrBtn.addEventListener('click', () => {
        modalPdfStage[slot] = null;
        setPdfLabel(slot, '— Removed on save —', 'removed');
    });

    card.appendChild(badge);
    card.appendChild(icon);
    card.appendChild(nameEl);
    card.appendChild(clrBtn);
    card.appendChild(inp);
    pdfRow.appendChild(card);

    pdfSlotLabels[slot] = nameEl;
    pdfSlotCards[slot] = card;

    // শুরুতে খালি স্লট
    setPdfLabel(slot, 'Select PDF', 'empty');
});
                // প্রোফাইল বদলালে/খুললে সেই প্রোফাইলের সেভ করা PDF নাম দেখাবে
        async function refreshModalPdfSlots(phone) {
            pdfInfoBox.style.display = 'none';
            for (const k of Object.keys(modalPdfStage)) delete modalPdfStage[k];
            const names = (phone && window._ivacPfApi)
                ? await window._ivacPfApi.getSlotNames(phone)
                : {};
            PDF_SLOT_DEFS.forEach(({ slot }) => {
                const n = names[slot];
                setPdfLabel(slot, n ? n : 'Select PDF', false);
            });
        }

        modal.appendChild(formRow0);
        modal.appendChild(formRow1);
        modal.appendChild(pdfRow);
                modal.appendChild(pdfInfoBox);
        modal.appendChild(formRow2);





        // ── Drag support ─────────────────────────────────────────
(function makeDraggable(panel, handle) {
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    handle.style.cursor = 'move';
    handle.style.userSelect = 'none';
    handle.style.touchAction = 'none';

    handle.addEventListener('pointerdown', (e) => {
        // বাটন / ইনপুটে ক্লিক করলে drag শুরু হবে না
        if (e.target.closest('button, select, input')) return;

        const rect = panel.getBoundingClientRect();

        // bottom/right পজিশন বাদ দিয়ে top/left এ রূপান্তর
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.transform = 'none';

        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;

        const rect = panel.getBoundingClientRect();
        let newLeft = startLeft + (e.clientX - startX);
        let newTop = startTop + (e.clientY - startY);

        // স্ক্রিনের বাইরে যেতে দেবে না
        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - rect.width));
        newTop = Math.max(0, Math.min(newTop, window.innerHeight - rect.height));

        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';
    });

    const stopDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        handle.releasePointerCapture(e.pointerId);
    };
    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);
})(modal, modalTitle);







        document.body.appendChild(modal);



        // ── Row 1: Phone | Password | Signin ──────────────────
        const row1 = document.createElement('div');
        Object.assign(row1.style, { display: 'flex', gap: '6px', alignItems: 'center' });

        const lastProfile = ProfileManager.getLast();
        const initialPhone = lastProfile ? lastProfile.phone : PHONE;
        const initialPass = lastProfile ? lastProfile.password : PASSWORD;

        const phoneInput = document.createElement('input');
        phoneInput.type = 'text';
        phoneInput.placeholder = 'Phone';
        phoneInput.value = initialPhone;
        Object.assign(phoneInput.style, {
            flex: '1', padding: '8px 10px', borderRadius: '8px',
            border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '500',
            background: '#f8fafc', color: '#0f172a', outline: 'none', minWidth: '0'
        });

        const passInput = document.createElement('input');
        passInput.type = 'text';
        passInput.placeholder = 'Password';
        passInput.value = initialPass;
        Object.assign(passInput.style, {
            flex: '1', padding: '8px 10px', borderRadius: '8px',
            border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '500',
            background: '#f8fafc', color: '#0f172a', outline: 'none', minWidth: '0'
        });

        const signinBtn = document.createElement('button');
        signinBtn.textContent = 'Signin';
        Object.assign(signinBtn.style, {
            width: RIGHT_WIDTH, height: '33px', boxSizing: 'border-box',
            padding: '0 4px', background: '#16a34a', color: '#fff',
            border: 'none', borderRadius: '8px', fontWeight: '600',
            fontSize: '12px', cursor: 'pointer', textAlign: 'center'
        });

        row1.appendChild(phoneInput);
        row1.appendChild(passInput);
        row1.appendChild(signinBtn);

        // ── Row 2: Get OTP | OTP | Verify ─────────────────────
        const row2 = document.createElement('div');
        Object.assign(row2.style, { display: 'flex', gap: '6px', alignItems: 'center' });

        const otpInput = document.createElement('input');
        otpInput.placeholder = 'OTP';
        otpInput.maxLength = 200;
        Object.assign(otpInput.style, {
            flex: '1', padding: '8px 10px', borderRadius: '8px',
            border: '1px solid #cbd5e1', fontSize: '13px', fontWeight: '700',
            background: '#f8fafc', color: '#0f172a', outline: 'none',
            minWidth: '0', letterSpacing: '2px', textAlign: 'center'
        });




        const getOtpBtn = document.createElement('button');
        getOtpBtn.textContent = 'Get OTP';
        Object.assign(getOtpBtn.style, {
            width: LEFT_WIDTH, height: '33px', boxSizing: 'border-box',
            padding: '0 2px', background: '#f1f5f9', color: '#475569',
            border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '600',
            fontSize: '11px', cursor: 'pointer', textAlign: 'center'
        });


        const verifyBtn = document.createElement('button');
        verifyBtn.textContent = 'Verify';
        Object.assign(verifyBtn.style, {
            width: RIGHT_WIDTH, height: '33px', boxSizing: 'border-box',
            padding: '0 4px', background: '#16a34a', color: '#fff',
            border: 'none', borderRadius: '8px', fontWeight: '600',
            fontSize: '12px', cursor: 'pointer', textAlign: 'center'
        });

        row2.appendChild(getOtpBtn);
        row2.appendChild(otpInput);
        row2.appendChild(verifyBtn);



        const statusEl = document.createElement('div');
        Object.assign(statusEl.style, {
            color: '#94a3b8', fontSize: '11px', fontWeight: '500',
            textAlign: 'center', height: '16px', lineHeight: '16px'
        });

        panel.appendChild(row0);
        panel.appendChild(row1);
        panel.appendChild(row2);


        // ── Capture rows ────────────────────────────────────────
        function createCaptureRow(bg) {
            const row = document.createElement('div');
            Object.assign(row.style, {
                display: 'none', gap: '6px', alignItems: 'center', marginTop: '4px'
            });
            const input = document.createElement('input');
            input.type = 'text';
            Object.assign(input.style, {
                flex: '1', padding: '6px 10px', borderRadius: '6px',
                border: '1px solid #cbd5e1', fontSize: '11px', background: bg,
                color: '#0f172a', outline: 'none', minWidth: '0',
                fontFamily: 'monospace', cursor: 'text'
            });
            const copyBtn = document.createElement('button');
            copyBtn.textContent = '📋';
            copyBtn.title = 'Copy';
            Object.assign(copyBtn.style, {
                width: '32px', height: '32px', boxSizing: 'border-box',
                border: '1px solid #cbd5e1', borderRadius: '6px',
                background: '#f1f5f9', cursor: 'pointer', fontSize: '13px', flexShrink: '0'
            });
            const openBtn = document.createElement('button');
            openBtn.textContent = 'Open';
            Object.assign(openBtn.style, {
                height: '32px', boxSizing: 'border-box', padding: '0 10px',
                border: 'none', borderRadius: '6px', background: '#2563eb',
                color: '#fff', cursor: 'pointer', fontSize: '11px',
                fontWeight: '600', flexShrink: '0'
            });
            openBtn.style.display = 'none';
            row.appendChild(input);
            row.appendChild(copyBtn);
            row.appendChild(openBtn);
            return { row, input, copyBtn, openBtn };
        }

        const paymentCapture = createCaptureRow('#faf5ff');

        let capturedReservationId = '';
        let capturedWebviewUrl = '';

        function setStatus(msg, color) {
            statusEl.style.color = color || '#94a3b8';
            statusEl.textContent = msg || '';
        }

        function showReservationId(id) {
            capturedReservationId = id;
            const idx = parseInt(getLastIdx());
            if (!isNaN(idx) && savedProfiles[idx]) {
                savedProfiles = loadProfiles();
                savedProfiles[idx].reservationId = id;
                saveProfiles(savedProfiles);
            }
        }

        function showWebviewUrl(url) {
            const now = Date.now();
            if (capturedWebviewUrl === url && (now - (window._lastWebviewOpenTime||0)) < 5000) {
            } else {
                AudioManager.playBeep();
                window.open(url, '_blank');
                window._lastWebviewOpenTime = now;
            }
            capturedWebviewUrl = url;
            paymentCapture.input.value = `Pay: ${url}`;
            paymentCapture.row.style.display = 'flex';
            paymentCapture.openBtn.style.display = 'block';
            paymentCapture.openBtn.onclick = () => window.open(url, '_blank');

            const idx = parseInt(getLastIdx());
            if (!isNaN(idx) && savedProfiles[idx]) {
                savedProfiles = loadProfiles();
                savedProfiles[idx].webviewUrl = url;
                saveProfiles(savedProfiles);
            }
        }

        paymentCapture.copyBtn.onclick = () => {
            if (!capturedWebviewUrl) return;
            ClipboardManager.copy(capturedWebviewUrl);
            setStatus('Payment URL copied!', '#4ade80');
            setTimeout(() => setStatus(''), 2000);
        };


        const xTokenStatus = document.createElement('div');
        xTokenStatus.style.display = 'none';

        function updateXTokenStatus() {
            if (!capturedXToken) {
                xTokenStatus.textContent = 'Captcha: not solved';
                xTokenStatus.style.color = '#94a3b8';
                return;
            }
            const remainingMs = 110000 - (Date.now() - capturedXTokenTime);
            if (remainingMs <= 0) {
                capturedXToken = '';
                GM_setValue('ivac_x_token', '');
                xTokenStatus.textContent = 'Captcha: expired';
                xTokenStatus.style.color = '#f87171';
                return;
            }
            const secs = Math.ceil(remainingMs / 1000);
            xTokenStatus.textContent = `✓ Ready (${secs}s)`;
            xTokenStatus.style.color = secs <= 20 ? '#f97316' : '#4ade80';
        }


        setInterval(updateXTokenStatus, 1000);
        updateXTokenStatus();

        const apptIdInput = document.createElement('input');
        apptIdInput.type = 'text';
        apptIdInput.placeholder = 'Appointment ID';
        apptIdInput.value = GM_getValue('ivac_appointment_id', '');
        Object.assign(apptIdInput.style, {
            flex: '1', padding: '8px 10px', borderRadius: '8px',
            border: '1px solid #cbd5e1', fontSize: '11px', fontFamily: 'monospace',
            background: '#f8fafc', color: '#0f172a', outline: 'none', minWidth: '0'
        });
        apptIdInput.addEventListener('change', () => GM_setValue('ivac_appointment_id', apptIdInput.value.trim()));



        panel.appendChild(statusEl);
        mountEl.appendChild(panel);

        // ── Profile functions ────────────────────────────────────
        function getOptLabel(p, i, short) {
            const type = p.type || 'T', count = p.count || 1, name = p.name ? `${p.name} ` : '';
            if (short) return `${i + 1}. ${name}[${type}-${count}]`;
            return `${i + 1}. ${name}${p.phone} [${type}-${count}]`;
        }

        function refreshProfileDropdown() {
            savedProfiles = loadProfiles();
            const lastIdx = getLastIdx();
            profileSelect.innerHTML = '';
            const defOpt = document.createElement('option');
            defOpt.value = '';
            defOpt.textContent = 'Select profile...';
            profileSelect.appendChild(defOpt);
            savedProfiles.forEach((p, i) => {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = String(i) === String(lastIdx) ? getOptLabel(p, i, true) : getOptLabel(p, i, false);
                profileSelect.appendChild(opt);
            });
            if (lastIdx !== '' && savedProfiles[lastIdx]) {
                profileSelect.value = lastIdx;
                const p = savedProfiles[lastIdx];
                phoneInput.value = p.phone;
                passInput.value = p.password;
                PHONE = p.phone;
                PASSWORD = p.password;
            }
            if (window._refreshSlotBDProfiles) window._refreshSlotBDProfiles();
        }
        window._refreshManualProfiles = refreshProfileDropdown;

        function refreshModalDropdown(selectIdx) {
            savedProfiles = loadProfiles();
            modalProfileSelect.innerHTML = '';
            const defOpt = document.createElement('option');
            defOpt.value = '';
            defOpt.textContent = 'New Profile';
            modalProfileSelect.appendChild(defOpt);
            savedProfiles.forEach((p, i) => {
                const opt = document.createElement('option');
                opt.value = i;
                const name = p.name ? `${p.name} ` : '';
                opt.textContent = `${i + 1}. ${name}${p.phone} [${p.type || 'T'}-${p.count || 1}]`;
                modalProfileSelect.appendChild(opt);
            });
            if (selectIdx !== undefined) modalProfileSelect.value = String(selectIdx);
        }

        function loadFormFromProfile(idx) {
            refreshModalPdfSlots(idx === '' || !savedProfiles[idx] ? '' : savedProfiles[idx].phone);
            if (idx === '' || !savedProfiles[idx]) {
                modalName.value = '';
                modalPhone.value = '';
                modalPass.value = '';
                modalType.value = '';
                modalCount.value = '1';
                return;
            }
            const p = savedProfiles[idx];
            modalName.value = p.name || '';
            modalPhone.value = p.phone;
            modalPass.value = p.password;
            modalType.value = p.type || '';
            modalCount.value = String(p.count || '1');
        }

        // ── Modal events ─────────────────────────────────────────
        settingsBtn.onclick = (e) => {
            e.stopPropagation();
            if (modal.style.display === 'flex') {
                modal.style.display = 'none';
                return;
            }
            const curIdx = profileSelect.value;
            refreshModalDropdown(curIdx !== '' ? curIdx : undefined);
            loadFormFromProfile(curIdx);
            if (curIdx !== '') modalProfileSelect.value = curIdx;
            modal.style.display = 'flex';
            modal.style.flexDirection = 'column';
        };

        window._openIvacProfileModal = (presetIdx) => {
            if (modal.style.display === 'flex') {
                modal.style.display = 'none';
                return;
            }
            const curIdx = presetIdx !== undefined && presetIdx !== null ? presetIdx : profileSelect.value;
            refreshModalDropdown(curIdx !== '' ? curIdx : undefined);
            loadFormFromProfile(curIdx);
            if (curIdx !== '') modalProfileSelect.value = curIdx;
            modal.style.display = 'flex';
            modal.style.flexDirection = 'column';
        };

        closeModalBtn.onclick = (e) => {
            e.stopPropagation();
            modal.style.display = 'none';
        };

        modalProfileSelect.addEventListener('change', () => loadFormFromProfile(modalProfileSelect.value));

        modalSaveBtn.onclick = () => {
            const name = modalName.value.trim(), phone = modalPhone.value.trim(), pass = modalPass.value.trim();
            const type = modalType.value, count = parseInt(modalCount.value) || 1;
            if (!phone || !pass) {
                setStatus('Phone & password required', '#f87171');
                setTimeout(() => setStatus(''), 2000);
                return;
            }
            savedProfiles = loadProfiles();
            const val = modalProfileSelect.value;
            let targetIdx;
            if (val === '') {
                savedProfiles.push({ name, phone, password: pass, type, count });
                targetIdx = savedProfiles.length - 1;
            } else {
                savedProfiles[parseInt(val)] = { name, phone, password: pass, type, count };
                targetIdx = parseInt(val);
            }
            saveProfiles(savedProfiles);
            const savedPhone = savedProfiles[targetIdx].phone;
            if (window._ivacPfApi) window._ivacPfApi.saveProfileFiles(savedPhone, { ...modalPdfStage });
            ProfileManager.setLast(targetIdx);
            refreshProfileDropdown();
            refreshModalDropdown('');
            loadFormFromProfile('');
            setStatus('Profile saved ✅', '#4ade80');
            setTimeout(() => setStatus(''), 2000);
        };

        modalDelBtn.onclick = () => {
            const val = modalProfileSelect.value;
            if (val === '') {
                setStatus('Select a profile to delete', '#f87171');
                return;
            }
            const p = savedProfiles[parseInt(val)];
            if (!confirm(`Delete: ${p.name || p.phone}?`)) return;
            savedProfiles = loadProfiles();
            savedProfiles.splice(parseInt(val), 1);
            saveProfiles(savedProfiles);
            if (window._ivacDeleteProfileFiles) window._ivacDeleteProfileFiles(p.phone);
            ProfileManager.clearLast();
            refreshProfileDropdown();
            refreshModalDropdown();
            loadFormFromProfile('');
            setStatus('Profile deleted', '#f87171');
            setTimeout(() => setStatus(''), 2000);
        };

        modalClearBtn.onclick = () => {
            if (!confirm('All profiles delete করবেন?')) return;
            savedProfiles.forEach(p => { if (window._ivacDeleteProfileFiles) window._ivacDeleteProfileFiles(p.phone); });
            saveProfiles([]);
            savedProfiles = [];
            ProfileManager.clearLast();
            refreshProfileDropdown();
            refreshModalDropdown();
            loadFormFromProfile('');
            phoneInput.value = '';
            passInput.value = '';
            setStatus('All profiles cleared', '#f87171');
            setTimeout(() => setStatus(''), 2000);
        };

      /*  exportBtn.onclick = () => {
            const list = loadProfiles();
            if (!list.length) {
                setStatus('No profiles', '#f87171');
                return;
            }
            const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ivac_profiles.json';
            a.click();
            URL.revokeObjectURL(url);
            setStatus('Exported ✅', '#4ade80');
            setTimeout(() => setStatus(''), 2000);
        };
        */

        exportBtn.onclick = async () => {
    const list = loadProfiles();
    if (!list.length) { setStatus('No profiles', '#f87171'); return; }
    setStatus('Exporting...', '#60a5fa');
    const files = window._ivacPfApi ? await window._ivacPfApi.exportFiles(list.map(p => p.phone)) : {};
    const blob = new Blob([JSON.stringify({ version: 2, profiles: list, files })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
const day = String(now.getDate()).padStart(2, '0');
const month = String(now.getMonth() + 1).padStart(2, '0');
const year = now.getFullYear();

a.download = `ivac_profiles_${day}-${month}-${year}_full.json`;

          //  a.download = 'ivac_profiles_full.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported ✅ (PDF সহ)', '#4ade80');
    setTimeout(() => setStatus(''), 2000);
};

      /*
      importBtn.onclick = () => fileInput.click();
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const parsed = JSON.parse(ev.target.result);
                    if (!Array.isArray(parsed)) throw new Error('Invalid format');
                    const valid = parsed.filter(p => p.phone);
                    if (!valid.length) throw new Error('No valid profiles');
                    saveProfiles(valid);
                    savedProfiles = valid;
                    ProfileManager.clearLast();
                    refreshProfileDropdown();
                    refreshModalDropdown();
                    loadFormFromProfile('');
                    modal.style.display = 'none';
                    setStatus(`✅ ${valid.length} profiles imported`, '#4ade80');
                    setTimeout(() => setStatus(''), 3000);
                } catch (err) {
                    setStatus(`❌ ${err.message}`, '#f87171');
                    setTimeout(() => setStatus(''), 3000);
                }
                fileInput.value = '';
            };
            reader.readAsText(file);
        });

        */

        importBtn.onclick = () => fileInput.click();
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                try {
                    const parsed = JSON.parse(ev.target.result);
                    const arr = Array.isArray(parsed) ? parsed : parsed.profiles;
                    if (!Array.isArray(arr)) throw new Error('Invalid format');
                    const valid = arr.filter(p => p.phone);
                    if (!valid.length) throw new Error('No valid profiles');
                    if (parsed.files && window._ivacPfApi) await window._ivacPfApi.importFiles(parsed.files);
                    saveProfiles(valid);
                    savedProfiles = valid;
                    ProfileManager.clearLast();
                    refreshProfileDropdown();
                    refreshModalDropdown();
                    loadFormFromProfile('');
                    modal.style.display = 'none';
                    const fc = parsed.files ? Object.keys(parsed.files).length : 0;
                    setStatus(`✅ ${valid.length} profiles imported${fc ? ` (${fc} profile এর PDF সহ)` : ''}`, '#4ade80');
                    setTimeout(() => setStatus(''), 3000);
                } catch (err) {
                    setStatus(`❌ ${err.message}`, '#f87171');
                    setTimeout(() => setStatus(''), 3000);
                }
                fileInput.value = '';
            };
            reader.readAsText(file);
        });



        // ── OTP handling ──────────────────────────────────────────
        function isOtpPage() {
            if (document.querySelector('input[id^="otp-"]')) return true;
            const boxes = [...document.querySelectorAll('input')].filter(el =>
               el !== otpInput && el !== phoneInput && el !== passInput &&
                (el.maxLength === 1 || el.getAttribute('maxlength') === '1')
            );
            if (boxes.length >= 4) return true;
            if (document.querySelector('input[autocomplete="one-time-code"], input[name="otp"]')) return true;
            return false;
        }

        function simulateInput(el, char) {
            el.focus();
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(el, char);
            const tracker = el._valueTracker;
            if (tracker) tracker.setValue('');
            ['keydown', 'keypress', 'keyup'].forEach(type => {
                el.dispatchEvent(new KeyboardEvent(type, {
                    key: char,
                    code: `Digit${char}`,
                    keyCode: 48 + parseInt(char),
                    which: 48 + parseInt(char),
                    bubbles: true,
                    cancelable: true
                }));
            });
            el.dispatchEvent(new InputEvent('input', {
                data: char,
                bubbles: true,
                cancelable: true,
                inputType: 'insertText'
            }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.blur();
        }

        function fillOtpBoxes(otp) {
            const digits = String(otp).replace(/\D/g, '');
            const byId = [...Array(6)].map((_, i) => document.getElementById(`otp-${i}`)).filter(Boolean);
            const byMaxLen = [...document.querySelectorAll('input')].filter(el =>
                el !== otpInput && el !== phoneInput && el !== passInput &&
                (el.maxLength === 1 || el.getAttribute('maxlength') === '1')
            );
            const boxes = byId.length >= 4 ? byId : byMaxLen;
            if (boxes.length >= 4) {
                boxes.forEach((el, i) => setTimeout(() => simulateInput(el, digits[i] || ''), i * 100));
                return;
            }
            const single = document.querySelector('input[autocomplete="one-time-code"], input[name="otp"], input[type="number"][maxlength="6"]');
            if (single) {
                simulateInput(single, digits);
                return;
            }
            const otpFields = [...document.querySelectorAll('input:not([type="hidden"]):not([type="submit"])')].filter(el => {
               if (el === otpInput || el === phoneInput || el === passInput) return false;
                const ph = (el.placeholder || '').toLowerCase(),
                    nm = (el.name || '').toLowerCase(),
                    id = (el.id || '').toLowerCase();
                return ph.includes('otp') || nm.includes('otp') || id.includes('otp') ||
                       ph.includes('code') || nm.includes('code') || id.includes('code');
            });
            if (otpFields.length > 0) otpFields.forEach((el, i) => setTimeout(() => simulateInput(el, digits[i] || ''), i * 100));
        }

        function startOtpPolling() {
            if (otpPoller) return;
            if (!PHONE) {
                setStatus('Phone number required', '#f87171');
                return;
            }
            otpAutoDone = false;
            setStatus('Fetching OTP...', '#f97316');
            getOtpBtn.textContent = 'Stop';
            Object.assign(getOtpBtn.style, {
                background: '#7f1d1d', color: '#fca5a5', border: '1px solid #fca5a5'
            });

            const poll = async () => {
                if (!PHONE) return;
                try {
                    const text = await gmFetch(OTP_API());
                    const otp = extractOtp(text);
                    if (otp) {
                        otpAutoDone = true;
                        stopOtpPolling();
                        otpPageDetected = false;
                        otpInput.value = otp;
                        otpInput.style.color = '#4ade80';
                        setTimeout(() => { otpInput.style.color = '#0f172a'; }, 2000);
                        setStatus(`OTP: ${otp}`, '#4ade80');

                        if (window._sharedOtp) {
                            window._sharedOtp.set(otp);
                        }

                        fillOtpBoxes(otp);
                        setTimeout(() => {
                            const submitBtn = document.querySelector('button[type="submit"]');
                            if (submitBtn && !submitBtn.disabled) {
                                submitBtn.click();
                                setStatus('Submitted!', '#4ade80');
                            }
                            setTimeout(() => setStatus(''), 4000);
                        }, 6 * 100 + 300);
                    } else {
                        setStatus('Waiting for OTP...', '#94a3b8');
                    }
                } catch (e) {
                    console.warn('OTP poll error:', e);
                }
            };

            poll();
            otpPoller = setInterval(poll, 2000);
        }

        function stopOtpPolling() {
            if (otpPoller) {
                clearInterval(otpPoller);
                otpPoller = null;
            }
            getOtpBtn.textContent = 'Get OTP';
            Object.assign(getOtpBtn.style, {
                background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1'
            });
        }





          profileSelect.addEventListener('change', () => {
            const idx = profileSelect.value;
                        if (idx === '') {
                ProfileManager.clearLast();
                if (window._ivacOnProfileChange) window._ivacOnProfileChange('');
                if (window._updateUploadProfileDisplay) window._updateUploadProfileDisplay();
                return;
            }
            const p = savedProfiles[idx];
            phoneInput.value = p.phone;
            passInput.value = p.password;
            PHONE = p.phone;
            PASSWORD = p.password;
            ProfileManager.setLast(idx);
            SharedProfile.set(p.phone, p.password);
            if (p.reservationId) {
                capturedReservationId = p.reservationId;
            }
            if (p.webviewUrl) {
                capturedWebviewUrl = p.webviewUrl;
                paymentCapture.input.value = `Pay: ${p.webviewUrl}`;
                paymentCapture.row.style.display = 'flex';
                paymentCapture.openBtn.style.display = 'block';
                paymentCapture.openBtn.onclick = () => window.open(p.webviewUrl, '_blank');
            }
            [...profileSelect.options].forEach((opt) => {
                if (opt.value === '') return;
                const pp = savedProfiles[opt.value];
                if (!pp) return;
                opt.textContent = String(opt.value) === String(idx) ?
                    getOptLabel(pp, parseInt(opt.value), true) :
                    getOptLabel(pp, parseInt(opt.value), false);
            });
            setStatus(`Loaded: ${p.name || p.phone}`, '#4ade80');
            setTimeout(() => setStatus(''), 2000);

            if (window._refreshSlotBDProfiles) window._refreshSlotBDProfiles();

            const nameEl = document.getElementById('global-profile-name');
            const phoneEl = document.getElementById('global-profile-phone');
            if (nameEl) nameEl.textContent = p.name || '—';
            if (phoneEl) phoneEl.textContent = p.phone;

            const sbSel = document.getElementById('sb-profile-select');
            if (sbSel) sbSel.value = idx;
        });

        signinBtn.onclick = () => {
            saveCredentials();
            if (!PHONE || !PASSWORD) {
                setStatus('Enter phone & password', '#f87171');
                return;
            }
            const phoneEl = document.querySelector('input[name="phone"]');
            const passEl = document.querySelector('input[name="password"]');
            if (phoneEl) setNativeValue(phoneEl, PHONE);
            if (passEl) setNativeValue(passEl, PASSWORD);
            setTimeout(() => {
                const submitBtn = [...document.querySelectorAll('button[type="submit"]')]
                    .find(b => b.textContent.toLowerCase().includes('sign')) ||
                    document.querySelector('button[type="submit"]');
                if (submitBtn && !submitBtn.disabled) {
                    submitBtn.click();
                    signinBtn.textContent = 'Done!';
                    setTimeout(() => { signinBtn.textContent = 'Signin'; }, 2000);
                }
            }, 300);
        };

        getOtpBtn.onclick = () => {
            if (otpPoller) {
                stopOtpPolling();
                otpPageDetected = false;
                otpAutoDone = true;
                setStatus('Stopped', '#f87171');
                setTimeout(() => setStatus(''), 1500);
            } else {
                saveCredentials();
                startOtpPolling();
            }
        };

        verifyBtn.onclick = () => {
            const digits = extractOtp(otpInput.value);
            if (digits.length === 6) {
                fillOtpBoxes(digits);
                setStatus(`Filling: ${digits}`, '#4ade80');
                setTimeout(() => {
                    const submitBtn = document.querySelector('button[type="submit"]');
                    if (submitBtn && !submitBtn.disabled) {
                        submitBtn.click();
                        setStatus('Submitted!', '#4ade80');
                    }
                    setTimeout(() => setStatus(''), 3000);
                }, 6 * 100 + 300);
            } else {
                setStatus('Enter valid 6-digit OTP', '#f87171');
                setTimeout(() => setStatus(''), 3000);
            }
        };

        otpInput.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasted = (e.clipboardData || window.clipboardData).getData('text');
            const digits = extractOtp(pasted);
            otpInput.value = digits;
            setStatus(`Converted: ${digits}`, '#94a3b8');
            if (digits.length === 6) {
                fillOtpBoxes(digits);
                setTimeout(() => setStatus(''), 2000);
            }
        });

        otpInput.addEventListener('input', () => {
            const raw = otpInput.value;
            if (/^\d+$/.test(raw)) {
                if (raw.length === 6) fillOtpBoxes(raw);
            } else {
                const digits = extractOtp(raw);
                otpInput.value = digits;
                if (digits.length === 6) fillOtpBoxes(digits);
            }
        });

        [phoneInput, passInput].forEach(el => el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') signinBtn.click();
        }));

        function saveCredentials() {
            PHONE = phoneInput.value.trim();
            PASSWORD = passInput.value;
            GM_setValue('ivac_phone', PHONE);
            GM_setValue('ivac_password', PASSWORD);
            SharedProfile.set(PHONE, PASSWORD);
        }

        // ── Network watcher ─────────────────────────────────────
        function checkNetworkPayload(rawText) {
            let json = null;
            try { json = JSON.parse(rawText); } catch {}
            if (json) {
                if (json.reservationId) showReservationId(json.reservationId);
                if (json.data && json.data.appointmentId) {
                    apptIdInput.value = json.data.appointmentId;
                    GM_setValue('ivac_appointment_id', json.data.appointmentId);
                }
            }
        }

        function captureXTokenFromHeaders(headersLike) {
            if (!headersLike) return;
            let val = null;
            try {
                if (headersLike instanceof Headers) val = headersLike.get('x-token') || headersLike.get('X-Token');
                else if (typeof headersLike === 'object') {
                    const key = Object.keys(headersLike).find(k => k.toLowerCase() === 'x-token');
                    if (key) val = headersLike[key];
                }
            } catch {}
            if (val && val !== capturedXToken) {
                capturedXToken = val;
                capturedXTokenTime = Date.now();
                GM_setValue('ivac_x_token', val);
                GM_setValue('ivac_x_token_time', String(capturedXTokenTime));
                updateXTokenStatus();
            }
        }

        (function watchNetwork() {
            const origFetch = window.fetch;
            if (typeof origFetch === 'function') {
                window.fetch = function(...args) {
                    try { captureXTokenFromHeaders(args[1] && args[1].headers); } catch {}
                    const result = origFetch.apply(this, args);
                    result.then((res) => {
                        try { if (res.ok) res.clone().text().then(checkNetworkPayload).catch(() => {}); } catch {}
                    }).catch(() => {});
                    return result;
                };
            }
            const origOpen = XMLHttpRequest.prototype.open,
                origSend = XMLHttpRequest.prototype.send,
                origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                this._otpWatchUrl = url;
                return origOpen.call(this, method, url, ...rest);
            };
            XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
                try {
                    if (name && name.toLowerCase() === 'x-token') captureXTokenFromHeaders({ 'x-token': value });
                } catch {}
                return origSetHeader.call(this, name, value);
            };
            XMLHttpRequest.prototype.send = function(...args) {
                this.addEventListener('load', function() {
                    try { if (this.status >= 200 && this.status < 300) checkNetworkPayload(this.responseText); } catch {}
                });
                return origSend.apply(this, args);
            };
        })();

        // ── Init ──────────────────────────────────────────────────
        refreshProfileDropdown();
        const lastIdx = getLastIdx();
        if (lastIdx !== '' && savedProfiles[lastIdx]) {
            const p = savedProfiles[lastIdx];
            if (p.reservationId) {
                capturedReservationId = p.reservationId;
            }
            if (p.webviewUrl) {
                capturedWebviewUrl = p.webviewUrl;
                paymentCapture.input.value = `Pay: ${p.webviewUrl}`;
                paymentCapture.row.style.display = 'flex';
                paymentCapture.openBtn.style.display = 'block';
                paymentCapture.openBtn.onclick = () => window.open(p.webviewUrl, '_blank');
            }
        }

      //  setTimeout(() => startAutoClick(), 500);

        new MutationObserver(() => {
            if (!otpPageDetected && isOtpPage() && !otpAutoDone) {
                otpPageDetected = true;
                setTimeout(() => startOtpPolling(), 1000);
            }
            if (otpPageDetected && !isOtpPage()) {
                otpPageDetected = false;
                stopOtpPolling();
                otpAutoDone = false;
            }
        }).observe(document.body, { childList: true, subtree: true });

        if (isOtpPage() && !otpAutoDone) {
            otpPageDetected = true;
            setTimeout(() => startOtpPolling(), 1000);
        }

        [signinBtn, getOtpBtn, verifyBtn, settingsBtn,
 modalSaveBtn, modalDelBtn, modalClearBtn, exportBtn, importBtn]
.forEach(addPressEffect);

    }

    // ================================================================
    // 🎯 PART 6: UPLOAD TAB
    // ================================================================

    let currentProfileName = '';
    let currentProfilePhone = '';

    function updateProfileDisplay() {
        try {
            const profiles = ProfileManager.load();
            const lastIdx = ProfileManager._lastIdx;

            if (lastIdx !== '' && profiles[lastIdx]) {
                const p = profiles[lastIdx];
                currentProfileName = p.name || '';
                currentProfilePhone = p.phone || '';
            } else {
                currentProfileName = '';
                currentProfilePhone = '';
            }

            const profileCard = document.getElementById('upload-profile-card');
            if (profileCard) {
                if (currentProfilePhone) {
                    profileCard.style.display = 'flex';
                    document.getElementById('upload-profile-name').textContent = currentProfileName || '—';
                    document.getElementById('upload-profile-phone').textContent = currentProfilePhone;
                } else {
                    profileCard.style.display = 'none';
                }
            }
        } catch (e) {}
    }

    SharedProfile.onChange(() => updateProfileDisplay());

    function runUploadTab(mountEl) {
        'use strict';





                    // ===== FILE SYNC BRIDGE: Dynamic tab <-> Manual tab (adjust) =====
            const SYNC_MAP = [
                { input: 'pdf-upload-patent',   adjKey: 'primary' },
                { input: 'pdf-upload-attend-1', adjKey: 'other1' },
                { input: 'pdf-upload-attend-2', adjKey: 'other2' },
                { input: 'pdf-upload-attend-3', adjKey: 'other3' }
            ];
            const ADJ_DB = 'IVAC_4_APPLICANTS_DB', ADJ_STORE = 'webfiles';
            const ADJ_MAX_SIZE = 500 * 1024;
            let syncBusy = false;

            function adjOpen() {
                return new Promise((resolve, reject) => {
                    const r = indexedDB.open(ADJ_DB, 1);
                    r.onupgradeneeded = e => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains(ADJ_STORE)) db.createObjectStore(ADJ_STORE);
                    };
                    r.onsuccess = () => resolve(r.result);
                    r.onerror = () => reject(r.error);
                });
            }

            async function adjWrite(fn) {
                const db = await adjOpen();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(ADJ_STORE, 'readwrite');
                    fn(tx.objectStore(ADJ_STORE));
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onerror = () => reject(tx.error);
                });
            }

            // Kafela -> Manual: ফাইল সিলেক্ট হলে Manual-এর DB-তে লিখবে
            async function mirrorToAdjust(map, file) {
                if (file.type !== 'application/pdf' || file.size > ADJ_MAX_SIZE) return;
                const record = {
                    name: file.name,
                    type: file.type || 'application/pdf',
                    size: file.size,
                    lastModified: file.lastModified,
                    data: await file.arrayBuffer()
                };
                await adjWrite(store => store.put(record, map.adjKey));
                document.dispatchEvent(new CustomEvent('ivac-files-changed', { detail: { source: 'kafela' } }));
            }

            async function removeFromAdjust(map) {
                await adjWrite(store => store.delete(map.adjKey));
                document.dispatchEvent(new CustomEvent('ivac-files-changed', { detail: { source: 'kafela' } }));
            }

            SYNC_MAP.forEach(map => {
                const input = document.getElementById(map.input);
                if (!input) return;
                input.addEventListener('change', async () => {
                    if (syncBusy) return;
                    try {
                        if (input.files.length) await mirrorToAdjust(map, input.files[0]);
                        else await removeFromAdjust(map);
                    } catch (err) {
                        console.error('[SYNC] Dynamic -> Manual failed:', err);
                    }
                });
            });

            // Manual -> Dynamic: Manual-এর DB দেখে Dynamic input আপডেট করবে
            function setDynamicInput(map, record) {
                const input = document.getElementById(map.input);
                const file = new File([record.data], record.name, {
                    type: record.type,
                    lastModified: record.lastModified
                });
                const dt = new DataTransfer();
                dt.items.add(file);
                syncBusy = true;
                try {
                    input.files = dt.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                } finally {
                    syncBusy = false;
                }
            }

            function clearDynamicInput(map) {
                const input = document.getElementById(map.input);
                if (!input || !input.files.length) return;
                syncBusy = true;
                try {
                    input.value = '';
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                } finally {
                    syncBusy = false;
                }
            }

            document.addEventListener('ivac-files-changed', async (e) => {
                if (e.detail?.source === 'kafela') return;
                try {
                    const db = await adjOpen();
                    for (const map of SYNC_MAP) {
                        const record = await new Promise(resolve => {
                            const req = db.transaction(ADJ_STORE, 'readonly')
                                          .objectStore(ADJ_STORE).get(map.adjKey);
                            req.onsuccess = () => resolve(req.result || null);
                            req.onerror = () => resolve(null);
                        });
                        const input = document.getElementById(map.input);
                        if (!input) continue;
                        if (record) {
                            if (!input.files.length || input.files[0].name !== record.name) {
                                setDynamicInput(map, record);
                            }
                        } else {
                            clearDynamicInput(map);
                        }
                    }
                    db.close();
                } catch (err) {
                    console.error('[SYNC] Manual -> Dynamic failed:', err);
                }
            });

            // "Clear pdf" বাটন: Manual-এর ফাইলও clear হবে
            document.getElementById('btn-clear-all')?.addEventListener('click', async () => {
                try {
                    await adjWrite(store => store.clear());
                    document.dispatchEvent(new CustomEvent('ivac-files-changed', { detail: { source: 'kafela' } }));
                } catch (err) {
                    console.error('[SYNC] Clear failed:', err);
                }
            });














        const apiUrl = (key) => APIManager.get(key);
        const BASE_API_URL = () => APIManager.get('baseApi') || 'https://api.ivacbd.com/iams/api/v1';

        if (document.getElementById('ivac-upload-overlay')) return;

        const MISSIONS_STATIC = [
            { id: "ac2040a9-24e2-4ca1-a661-079658d80638", missionName: "Chittagong", city: "Chittagong", code: "HC_CTG_001" },
            { id: "ddfdbcb9-27dd-4abd-9e46-fcdb0d8c1895", missionName: "Dhaka", city: "Dhaka", code: "HC_DHK_001" },
            { id: "55d42891-1a7e-498c-ad98-a5be4fcfa4d5", missionName: "Khulna", city: "Khulna", code: "HC_KHL_001" },
            { id: "180847cf-bd6d-4a34-8347-57a344746b02", missionName: "Rajshahi", city: "Rajshahi", code: "HC_RAJ_001" },
            { id: "7ebb11f2-b7c3-4fb2-9f80-d704d7e6f509", missionName: "Sylhet", city: "Sylhet", code: "HC_SYL_001" }
        ];

        const CENTERS_STATIC = {
            "ac2040a9-24e2-4ca1-a661-079658d80638": [{ centerName: "IVAC, Chittagong" }],
            "ddfdbcb9-27dd-4abd-9e46-fcdb0d8c1895": [{ centerName: "IVAC, Dhaka (JFP)" }],
            "55d42891-1a7e-498c-ad98-a5be4fcfa4d5": [{ centerName: "IVAC, Khulna" }],
            "180847cf-bd6d-4a34-8347-57a344746b02": [{ centerName: "IVAC, Rajshahi" }],
            "7ebb11f2-b7c3-4fb2-9f80-d704d7e6f509": [{ centerName: "IVAC, Sylhet" }],
        };

        function getCachedCenters(missionId) {
            try {
                const raw = GM_getValue(`ivac_centers_cache_${missionId}`, '');
                return raw ? JSON.parse(raw) : null;
            } catch { return null; }
        }

        function setCachedCenters(missionId, centersArr) {
            GM_setValue(`ivac_centers_cache_${missionId}`, JSON.stringify(centersArr));
        }


        let lastOverviewData = [];
        let turnstileWidgetId = null;

        const DB_NAME = "IVAC_File_Storage", DB_VERSION = 1, STORE_NAME = "pdf_files";

        function initDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
                };
                request.onsuccess = (e) => resolve(e.target.result);
                request.onerror = (e) => reject(e.target.error);
            });
        }

        async function saveFileToDB(key, file, parsedName = "") {
            try {
                const db = await initDB();
                const tx = db.transaction(STORE_NAME, "readwrite");
                tx.objectStore(STORE_NAME).put({ file, name: file.name, parsedName }, key);
                return new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
            } catch (err) {
                console.error("IndexedDB Save Error:", err);
            }
        }

        async function getFileFromDB(key) {
            try {
                const db = await initDB();
                const tx = db.transaction(STORE_NAME, "readonly");
                const request = tx.objectStore(STORE_NAME).get(key);
                return new Promise((resolve, reject) => {
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            } catch (err) {
                console.error("IndexedDB Load Error:", err);
                return null;
            }
        }

        // ===== PER-PROFILE FILE SETS =====
        // Active slots (patent, attend1..3) = এখন UI ও upload এ ব্যবহার হচ্ছে
        // Profile copy = profile::<phone>::<slot> (একই IndexedDB store এ)
        const PF_SLOTS = [
            { slot: 'patent',  adjKey: 'primary', inputId: 'pdf-upload-patent',   infoId: 'file-info-patent',   label: '📂 Primary File' },
            { slot: 'attend1', adjKey: 'other1',  inputId: 'pdf-upload-attend-1', infoId: 'file-info-attend-1', label: '📂 S File 1' },
            { slot: 'attend2', adjKey: 'other2',  inputId: 'pdf-upload-attend-2', infoId: 'file-info-attend-2', label: '📂 S File 2' },
            { slot: 'attend3', adjKey: 'other3',  inputId: 'pdf-upload-attend-3', infoId: 'file-info-attend-3', label: '📂 S File 3' }
        ];
        const pfKey = (phone, slot) => `profile::${phone}::${slot}`;
        let pfQueue = Promise.resolve();

        function pfEnqueue(fn) {
            pfQueue = pfQueue.then(fn).catch(err => console.error('[PROFILE-FILES]', err));
            return pfQueue;
        }

        // rec থাকলে put, null হলে delete
        async function pfPut(key, rec) {
            const db = await initDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                if (rec) store.put(rec, key);
                else store.delete(key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }

        async function pfProfileHasFiles(phone) {
            for (const s of PF_SLOTS) {
                const rec = await getFileFromDB(pfKey(phone, s.slot));
                if (rec && rec.file) return true;
            }
            return false;
        }

        // Active ফাইল → প্রোফাইল
        async function pfSaveActiveTo(phone) {
            if (!phone) return;
            for (const s of PF_SLOTS) {
                const rec = await getFileFromDB(s.slot);
                await pfPut(pfKey(phone, s.slot), rec && rec.file ? rec : null);
            }
        }

        // Manual tab এর adjustment DB মিরর
        async function pfMirrorAdj(adjKey, file) {
            let record = null;
            if (file && file.type === 'application/pdf' && file.size <= ADJ_MAX_SIZE) {
                record = {
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    lastModified: file.lastModified,
                    data: await file.arrayBuffer()
                };
            }
            await adjWrite(store => record ? store.put(record, adjKey) : store.delete(adjKey));
        }

        // প্রোফাইল → Active ফাইল
        async function pfLoadProfileToActive(phone) {
            for (const s of PF_SLOTS) {
                const rec = phone ? await getFileFromDB(pfKey(phone, s.slot)) : null;
                const rec2 = rec && rec.file ? rec : null;
                await pfPut(s.slot, rec2);
                await pfMirrorAdj(s.adjKey, rec2 ? rec2.file : null);
            }
        }

        // Info bar + input UI আপডেট
        async function pfRefreshUI() {
            for (const s of PF_SLOTS) {
                const input = document.getElementById(s.inputId);
                const bar = document.getElementById(s.infoId);
                const rec = await getFileFromDB(s.slot);
                if (input) input.value = '';
                if (!bar) continue;
                if (rec && rec.file) {
                    const match = rec.name.match(/BGD[A-Z0-9]{8,}/i);
                    const code = match ? match[0].slice(0, 10) : rec.name.slice(0, 8);
                    bar.textContent = rec.parsedName || code;
                    bar.classList.add('has-file');
                    bar.style.borderStyle = 'solid';
                } else {
                    bar.textContent = s.label;
                    bar.classList.remove('has-file');
                    bar.style.borderStyle = '';
                }
            }
            document.dispatchEvent(new CustomEvent('ivac-files-changed', { detail: { source: 'profile' } }));
        }

        // মূল switch logic
                async function pfSwitchTo(newPhone) {
            const owner = GM_getValue('ivac_files_owner', '');

          //  if (owner && owner !== newPhone) await pfSaveActiveTo(owner);

            if (owner === newPhone && newPhone) return;

            await pfLoadProfileToActive(newPhone || '');
            GM_setValue('ivac_files_owner', newPhone || '');
            await pfRefreshUI();
        }



        // ---- Public hooks ----
        window._ivacOnProfileChange = (phone) => pfEnqueue(() => pfSwitchTo(phone || ''));

        window._ivacSaveFilesToProfile = (phone) => pfEnqueue(async () => {
            if (!phone) return;
            await pfSaveActiveTo(phone);
            GM_setValue('ivac_files_owner', phone);
        });
// Upload-tab files no longer persist into profiles. Profile PDFs change only via Profile Manager (saveProfileFiles).
window._ivacPersistActive = () => Promise.resolve();

        window._ivacDeleteProfileFiles = (phone) => pfEnqueue(async () => {
            if (!phone) return;
            for (const s of PF_SLOTS) await pfPut(pfKey(phone, s.slot), null);
            if (GM_getValue('ivac_files_owner', '') === phone) {
                GM_setValue('ivac_files_owner', '');
                await pfLoadProfileToActive('');
                await pfRefreshUI();
            }
        });

        // Startup: শেষ নির্বাচিত প্রোফাইলের ফাইল load
        pfEnqueue(async () => {
            const list = ProfileManager.load();
            const idx = ProfileManager._lastIdx;
            await pfSwitchTo(list[idx] ? list[idx].phone : '');
        });

      /*  // Modal থেকে ব্যবহৃত API
                window._ivacPfApi = {
            getSlotNames: async (phone) => {
                const out = {};
                for (const s of PF_SLOTS) {
                    const rec = phone ? await getFileFromDB(pfKey(phone, s.slot)) : null;
                    if (!rec || !rec.file) {
                        out[s.slot] = null;
                        continue;
                    }
                    let label = null;
                    try {
                        if (window._ivacPdfLabel) label = await window._ivacPdfLabel(rec.file);
                    } catch (e) {}
                    out[s.slot] = label || rec.parsedName || rec.name;
                }
                return out;
            },
            saveProfileFiles: (phone, stage) => pfEnqueue(async () => {
                if (!phone) return;
                for (const s of PF_SLOTS) {
                    const v = stage[s.slot];
                    if (v === undefined) continue;                        // বদলায়নি
                    if (v === null) { await pfPut(pfKey(phone, s.slot), null); continue; }
                    let parsedName = '';
                    try { parsedName = (await extractNameFromPDF(v)) || ''; } catch (e) {}
                    await pfPut(pfKey(phone, s.slot), { file: v, name: v.name, parsedName });
                }
                // এই প্রোফাইলই যদি active হয়, active ফাইল ও UI আপডেট
                if (GM_getValue('ivac_files_owner', '') === phone) {
                    await pfLoadProfileToActive(phone);
                    await pfRefreshUI();
                }
            })
        };

        */

        window._ivacPfApi = {
    getSlotNames: async (phone) => {
        const out = {};
        for (const s of PF_SLOTS) {
            const rec = phone ? await getFileFromDB(pfKey(phone, s.slot)) : null;
            if (!rec || !rec.file) { out[s.slot] = null; continue; }
            let label = null;
            try { if (window._ivacPdfLabel) label = await window._ivacPdfLabel(rec.file); } catch (e) {}
            out[s.slot] = label || rec.parsedName || rec.name;
        }
        return out;
    },
    saveProfileFiles: (phone, stage) => pfEnqueue(async () => {
        if (!phone) return;
        for (const s of PF_SLOTS) {
            const v = stage[s.slot];
            if (v === undefined) continue;
            if (v === null) { await pfPut(pfKey(phone, s.slot), null); continue; }
            let parsedName = '';
            try { parsedName = (await extractNameFromPDF(v)) || ''; } catch (e) {}
            await pfPut(pfKey(phone, s.slot), { file: v, name: v.name, parsedName });
        }
        if (GM_getValue('ivac_files_owner', '') === phone) {
            await pfLoadProfileToActive(phone);
            await pfRefreshUI();
        }
    }),
    exportFiles: async (phones) => {
       /*
       await pfEnqueue(async () => {
            const owner = GM_getValue('ivac_files_owner', '');
            if (owner) await pfSaveActiveTo(owner);
        });
        */
        const out = {};
        for (const phone of phones) {
            for (const s of PF_SLOTS) {
                const rec = await getFileFromDB(pfKey(phone, s.slot));
                if (!rec || !rec.file) continue;
                const buf = new Uint8Array(await rec.file.arrayBuffer());
                let bin = '';
                for (let i = 0; i < buf.length; i += 0x8000)
                    bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
                (out[phone] = out[phone] || {})[s.slot] = {
                    name: rec.name,
                    parsedName: rec.parsedName || '',
                    type: rec.file.type || 'application/pdf',
                    lastModified: rec.file.lastModified,
                    b64: btoa(bin)
                };
            }
        }
        return out;
    },
    importFiles: (files) => pfEnqueue(async () => {
        for (const phone of Object.keys(files || {})) {
            for (const s of PF_SLOTS) {
                const d = files[phone][s.slot];
                if (!d) continue;
                const bin = atob(d.b64);
                const u8 = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                const file = new File([u8], d.name, { type: d.type, lastModified: d.lastModified });
                await pfPut(pfKey(phone, s.slot), { file, name: d.name, parsedName: d.parsedName });
            }
        }
        const owner = GM_getValue('ivac_files_owner', '');
        if (owner && files[owner]) {
            await pfLoadProfileToActive(owner);
            await pfRefreshUI();
        }
    })
};




        // Clear: শুধু active slot গুলো clear হবে, প্রোফাইলের copy থাকবে
        async function clearAllSavedFilesFromDB() {
            for (const s of PF_SLOTS) await pfPut(s.slot, null);
        }

        function loadPDFJS() {
            return new Promise((resolve, reject) => {
                if (unsafeWindow.pdfjsLib) {
                    resolve(unsafeWindow.pdfjsLib);
                    return;
                }
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
                script.onload = () => {
                    unsafeWindow.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                    resolve(unsafeWindow.pdfjsLib);
                };
                script.onerror = () => reject(new Error('PDF.js library load failed.'));
                document.head.appendChild(script);
            });
        }

        async function extractNameFromPDF(file) {
            try {
                const pdfjsLib = await loadPDFJS();
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                const page = await pdf.getPage(1);
                const textContent = await page.getTextContent();
                let fullText = "";
                textContent.items.forEach(item => { fullText += item.str + " "; });

                const surnameMatch = fullText.match(/Surname\s*\(As\s*in\s*Passport\)\s*([A-Z\s]+)/i);
                const givenNameMatch = fullText.match(/Given\s*Name\s*\(As\s*in\s*Passport\)\s*([A-Z\s]+)/i);
                let surname = surnameMatch ? surnameMatch[1].trim() : "";
                let givenName = givenNameMatch ? givenNameMatch[1].trim() : "";
                const noiseWords = /\s*\b(Given|Surname|Name|Previous|Passport|Date|Sex|Place|Country|Birth|Nationality)\b.*/i;
                surname = surname.split(noiseWords)[0].trim();
                givenName = givenName.split(noiseWords)[0].trim();
                if (givenName || surname) return `${givenName} ${surname}`.replace(/\s+/g, ' ').trim();
            } catch (e) {
                console.error("Error parsing PDF name:", e);
            }
            return "";
        }

        function addStyles() {
            if (document.getElementById('ivac-upload-tools-style')) return;
            const style = document.createElement('style');
            style.id = 'ivac-upload-tools-style';
            style.textContent = `
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
                #ivac-upload-overlay * { font-family: sans-serif !important; box-sizing: border-box; text-align: left; }
                #ivac-upload-overlay { position: relative; width: 100%; background: transparent; border: none; border-radius: 0; box-shadow: none; font-family: 'Inter', sans-serif; color: #1e293b; overflow: visible; }
                .ivac-header { background: #f8fafc; padding: 10px 12px; display: flex; justify-content: center; align-items: center; cursor: grab; border-bottom: 1px solid #e2e8f0; user-select: none; }
                .header-title { font-weight: 700; font-size: 11px; color: #0f172a; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px; }
                .pulse-icon { animation: ivacPulse 2s infinite; }
                @keyframes ivacPulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
                .tab-content { padding: 10px; }
                .ivac-status-bar { background: #f1f5f9; color: #0f172a; font-size: 10px; padding: 6px 8px; text-align: left; border-radius: 4px; border: 1px solid #e2e8f0; font-weight: 600; line-height: 1.4; margin-bottom: 10px; max-height: 220px; overflow-y: auto; }
                .form-row { margin-bottom: 8px; }
                .modern-input { width: 100%; background: #ffffff; border: 1px solid #cbd5e1; color: #0f172a; border-radius: 4px; font-size: 11px; padding: 6px 10px; outline: none; transition: border 0.2s; }
                .modern-input:focus { border-color: #0284c7; }
                .file-input { height: auto !important; cursor: pointer; }
                .file-info-bar { font-size: 10px; color: #64748b; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px; padding: 7px 10px; margin-bottom: 0; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .file-info-bar.has-file { color: #16a34a; border-color: #bbf7d0; background: #f0fdf4; font-weight: 600; }
                .btn-row { display: flex; gap: 4px; }
                .modern-btn { flex: 1; border: 1px solid #e2e8f0; border-radius: 4px; height: 30px; padding: 0 8px; font-size: 11px; font-weight: 600; cursor: pointer; color: #0f172a; background: #ffffff; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.15s; }
                .modern-btn:hover { background: #f1f5f9; }
                .modern-btn:active { transform: scale(0.97); }
                .modern-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; background: #f1f5f9; }
                .btn-patent { background: #e0f2fe; border-color: #bae6fd; color: #0369a1; }
                .btn-attend { background: #f3e8ff; border-color: #e9d5ff; color: #6b21a8; }
                .btn-done { background: #dcfce7 !important; border-color: #bbf7d0 !important; color: #15803d !important; }
                .btn-highcomm { background: #fee2e2; border-color: #fecaca; color: #b91c1c; }
                .btn-overview { background: #fef3c7; border-color: #fde68a; color: #b45309; }
                .btn-appointment { background: #e0e7ff; border-color: #c7d2fe; color: #4338ca; }
                .btn-booking { background: #e0fdf4; border-color: #99f6e4; color: #0f766e; }
                .btn-delete { background: #fff5f5; border-color: #feb2b2; color: #c53030; }
                .btn-download-inv { background: #0f172a; color: #ffffff; border: none; font-weight: 700; }
                .btn-download-inv:hover { background: #1e293b; color: #ffffff; }
                .action-row { display: flex; gap: 3px; margin-bottom: 8px; }
                .action-btn { flex: 1; min-width: 0; border: 1px solid #e2e8f0; border-radius: 4px; height: 32px; padding: 0 2px; font-size: 12px; font-weight: 700; cursor: pointer; color: #fff; background: #14a800; display: flex; align-items: center; justify-content: center; text-align: center; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: all 0.15s; }
                .action-btn:hover {  background: #1a5a49; }
                .action-btn:active { transform: scale(0.96); }
                .invoice-row { display: flex; gap: 4px; align-items: stretch; }
                .invoice-row .modern-input { flex: 1; min-width: 0; margin-bottom: 0; }
                .invoice-row .btn-download-inv { flex: 0 0 60px; width: 60px; height: 30px; font-size: 10px; border-radius: 4px; }
                .nav-divider { border-top: 1px solid #e2e8f0; margin: 10px 0; }
                .section-label { font-size: 9px; font-weight: 800; color: #64748b; letter-spacing: 0.5px; margin-bottom: 6px; text-transform: uppercase; }
                .btn-reupload { background: #fff7ed; border-color: #fed7aa; color: #c2410c; }
                .btn-clear-all { background: #FF0000; border-color: #cbd5e1; color: #ffffff; font-weight: bold; }
                .btn-clear-all:hover { background: #8B0000; }
                #hc-city-select option, #ivac-center-select option, #delete-file-select option { background: #ffffff; color: #0f172a; }
                .ov-item { border-top: 1px dashed #e2e8f0; padding: 5px 2px; }
                .ov-item:first-child { border-top: none; padding-top: 0; }
                .ov-name { font-weight: 700; color: #0f172a; }
                .ov-meta { color: #475569; font-weight: 500; }
                .ov-primary-badge { display:inline-block; font-size:8.5px; font-weight:800; color:#0369a1; background:#e0f2fe; border:1px solid #bae6fd; border-radius:4px; padding:0 4px; margin-left:4px; }
                .err-item { border-top: 1px dashed #fecaca; padding: 4px 2px; color: #b91c1c; font-weight: 600; }
                .err-item:first-child { border-top: none; padding-top: 0; }
            `;
            document.head.appendChild(style);
        }

        function createUI() {
            const container = document.createElement('div');
            container.id = 'ivac-upload-overlay';

            container.innerHTML = `

            `;

            mountEl.appendChild(container);
            addStyles();
            attachEvents();
            populateMissionOptions();
            loadSavedFilesFromDB();
          //  loadAppointmentContext();
           // renderTurnstileWidget();
        }

        function setStatus(html, ok = true) {
            const el = document.getElementById('sb-msg');
            if (!el) return;
            el.style.display = 'block';
            if (ok) {
                el.style.color = '#16a34a';
                el.style.borderColor = '#bbf7d0';
                el.style.background = '#f0fdf4';

            } else {
                el.style.color = '#dc2626';
                el.style.borderColor = '#fca5a5';
                el.style.background = '#fef2f2';
            }
            el.innerHTML = html;
        }

        function setLoading(text) {
            const el = document.getElementById('sb-msg');
            if (!el) return;
            el.style.display = 'block';
            el.style.color = '#2563eb';
            el.style.background = '#eff6ff';
            el.style.borderColor = '#bfdbfe';
            el.textContent = text
        }


       // ✅ KEEP এবং এভাবে UPDATE করুন:
async function ensureXToken() {
    if (TokenPoolManager.count() > 0) {
        const token = TokenPoolManager.pop();
        return token;
    }

    setLoading('🔄 Waiting for Captcha from SlotBD tab...');
    const token = await TokenPoolManager.waitForToken();
    if (token) {
        return token;
    }
    return null;
}

        function hasErrors(errors) {
            if (!errors) return false;
            if (typeof errors === 'string') return errors.length > 0;
            if (Array.isArray(errors)) return errors.length > 0;
            if (typeof errors === 'object') return Object.keys(errors).length > 0;
            return false;
        }

        function toErrorList(errors) {
            if (typeof errors === 'string') return [errors];
            if (Array.isArray(errors)) return errors.map(e => typeof e === 'string' ? e : JSON.stringify(e));
            if (typeof errors === 'object') return Object.values(errors).map(e => typeof e === 'string' ? e : JSON.stringify(e));
            return [String(errors)];
        }

        function populateCenterDropdown(centersArr) {
            const centerSelect = document.getElementById('ivac-center-select');
            centerSelect.innerHTML = '<option value="">Select Center</option>';
            centersArr.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.centerName;
                opt.textContent = c.centerName;
                centerSelect.appendChild(opt);
            });
        }

        function populateMissionOptions() {
            const select = document.getElementById('hc-city-select');
            if (select.options.length > 1) return;
            select.innerHTML = '<option value="">Select Mission</option>';
            MISSIONS_STATIC.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.city;
                select.appendChild(opt);
            });
        }

        let selectedMission = null;
        let selectedCenter = null;

        function selectCenterByName(centerName) {
            const centerSelect = document.getElementById('ivac-center-select');
            if (!centerName) {
                selectedCenter = null;
                return;
            }
            centerSelect.value = centerName;
            selectedCenter = centerName;
            setStatus(`Target: <b>${selectedMission}</b> / <b>${centerName}</b>`, true);
        }

        async function selectMissionById(selectedId) {
            const hcSelect = document.getElementById('hc-city-select');
            selectedCenter = null;
            document.getElementById('ivac-center-select').innerHTML = '<option value="">Select Center</option>';
            if (!selectedId) {
                selectedMission = null;
                return;
            }

            populateMissionOptions();
            hcSelect.value = selectedId;
            const missionMeta = MISSIONS_STATIC.find(m => m.id === selectedId);
            selectedMission = missionMeta ? missionMeta.city : null;

            const finishWithCenters = (centersArr, noRequestMsg) => {
                populateCenterDropdown(centersArr);
                if (centersArr.length === 1) selectCenterByName(centersArr[0].centerName);
                else setStatus(`Mission: <b>${selectedMission}</b> — Select Center ${noRequestMsg}`, true);
            };

            const staticCenters = CENTERS_STATIC[selectedId];
            if (staticCenters && staticCenters.length) {
                finishWithCenters(staticCenters, '(no request)');
                return;
            }

            const cachedCenters = getCachedCenters(selectedId);
            if (cachedCenters && cachedCenters.length) {
                finishWithCenters(cachedCenters, '(cached — no request)');
                return;
            }

            setLoading('🔄 Center Info (first time only)...');
            try {
                const authToken = AuthManager.getToken();
                const res = await fetch(`${BASE_API_URL()}/ivac-centers/${selectedId}`, {
                    method: 'GET',
                    headers: {
                        'accept': 'application/json, text/plain, */*',
                        'Authorization': `Bearer ${authToken}`
                    }
                });
                const response = await res.json();
                if (response.data && response.data.length) {
                    setCachedCenters(selectedId, response.data);
                    finishWithCenters(response.data, '');
                } else {
                    setStatus(`❌ No Center Found`, false);
                }
            } catch (error) {
                setStatus(`❌ Center Error`, false);
            }
        }

        async function autoSelectFromOverview(overview) {
            if (!overview || !overview.commissionId) return;
            if (selectedMission && selectedCenter) return;
            await selectMissionById(overview.commissionId);
        }

        async function loadSavedFilesFromDB() {
            const slots = [
                { key: 'patent', infoId: 'file-info-patent' },
                { key: 'attend1', infoId: 'file-info-attend-1' },
                { key: 'attend2', infoId: 'file-info-attend-2' },
                { key: 'attend3', infoId: 'file-info-attend-3' }
            ];
            for (const slot of slots) {
                const saved = await getFileFromDB(slot.key);
                if (saved && saved.name) {
                    const infoBar = document.getElementById(slot.infoId);
                    if (infoBar) {
                        const match = saved.name.match(/BGD[A-Z0-9]{8,}/i);
                        const fileCode = match ? match[0].slice(0, 10) : saved.name.slice(0, 8);
                        const displayName = saved.parsedName ? `${saved.parsedName}` : `${fileCode}`;
                        infoBar.textContent = displayName;
                        infoBar.classList.add('has-file');
                        infoBar.style.borderStyle = 'solid';
                    }
                }
            }
        }

        function populateFileSelects(data) {
            lastOverviewData = data || [];
            const deleteSelect = document.getElementById('delete-file-select');
            if (!deleteSelect) return;
            deleteSelect.innerHTML = '<option value="">Select File (Delete / Re-upload)</option>';
            lastOverviewData.forEach(d => {
                if (!d.applicationId) return;
                const opt = document.createElement('option');
                opt.value = d.applicationId;
                opt.textContent = `${d.applicationId} — ${d.fullName || ''}${d.primary ? ' (Primary)' : ''}`;
                deleteSelect.appendChild(opt);
            });
        }





        function extractAppointmentName(data) {
    const d = data?.data || data || {};
    return d.applicantName || d.name || d.fullName || d.applicant?.name || d.applicant?.fullName ||
        (Array.isArray(d) && d[0] && (d[0].applicantName || d[0].name)) || null;
}

async function loadAppointmentContext() {
    setLoading('🔄 Loading appointment...');
    try {
        const authToken = AuthManager.getToken();
        const res = await fetch(APIManager.get('appointment'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({})
        });
        const data = await res.json();

        if (res.ok && data) {
            const name = extractAppointmentName(data);
            // সার্ভার থেকে আসা অরিজিনাল মেসেজ (message বা msg ফিল্ড চেক করবে)
            const serverMsg = data.message || data.msg || 'Success';

            setStatus(name ? `✅ Appointment: <b>${name}</b>` : `✅ ${serverMsg}`, true);
            AudioManager.playBeep();

        } else {
            // রিকোয়েস্ট ফেইল হলেও সার্ভারের অরিজিনাল এরর মেসেজ দেখাবে
            const errorMsg = data?.message || data?.error || 'Context Failed';
            setStatus(`❌ ${errorMsg}`, false);
        }
    } catch (e) {
        setStatus(`❌ Error: ${e.message}`, false);
    }
}

   async function uploadSingle(isPrimary, btnId, fileInputId, dbKey) {
            const fileInput = document.getElementById(fileInputId);
            const btn = document.getElementById(btnId);
            let file = null;

            if (fileInput.files.length) file = fileInput.files[0];
            else {
                const savedData = await getFileFromDB(dbKey);
                if (savedData && savedData.file) file = savedData.file;
            }

           if (!file) {
    // ✅ ফাইল না থাকলে কোনো dialog আসবে না, শুধু return করবে
    console.log(`⏭️ ${fileInputId} এ কোনো ফাইল নেই, dialog আসবে না`);
    return;  // ← শেষ, আর কিছু হবে না
}

            if (file.type !== 'application/pdf') {
                setStatus(`❌ ${file.name} not PDF`, false);
                return;
            }

            if (file.size > 500 * 1024) {
                setStatus(`❌ ${file.name} > 500KB`, false);
                return;
            }

            const originalHTML = btn.innerHTML;
            const xToken = await ensureXToken();
            if (!xToken) {
                setStatus('❌ Captcha token পাওয়া যায়নি!', false);
                btn.innerHTML = originalHTML;
                return;
            }
            const authToken = AuthManager.getToken();

            setLoading(`🔄 Uploading...`);
            try {
                const formData = new FormData();
                formData.append('files', file);
                formData.append('isPrimary', isPrimary ? 'true' : 'false');

                const uploadUrl = APIManager.get('uploadFile');
                const fetchPromise = fetch(uploadUrl, {
                    method: "POST",
                    headers: {
                        "accept": "application/json, text/plain, */*",
                        "Authorization": `Bearer ${authToken}`,
                        "cache-control": "no-cache, no-store, must-revalidate",
                        "pragma": "no-cache",
                        "x-sec-runtime-state": getSecHeaders().runtime,
                        "x-token": xToken
                    },
                    referrer: "https://appointment.ivacbd.com/",
                    body: formData
                });


                const res = await fetchPromise;
                const data = await res.json();
                const serverMsg = data.message || "Done";
                const overview = data?.data?.overview || null;
                const errors = data?.data?.error || data?.error || data?.errors;

                if (!res.ok) {
                    setStatus(`❌ [${res.status}] ${serverMsg}`, false);
                    btn.innerHTML = originalHTML;
                    return;
                }

                if (hasErrors(errors)) {
                    const errorList = toErrorList(errors);
                    const errorHtml = errorList.map(e => `<div class="err-item">⚠️ ${e}</div>`).join('');
                    let detailsHtml = '';
                    if (overview) {
                        detailsHtml = `<div class="ov-item"><div class="ov-name">${overview.fullName || '-'}${overview.primary ? '<span class="ov-primary-badge">PRIMARY</span>' : ''}</div><div class="ov-meta">${overview.applicationId || '-'} | ${overview.passport || '-'}</div><div class="ov-meta">${overview.commissionName || '-'} | ${overview.visaType || '-'}</div></div>`;
                    }
                    setStatus(`❌ Mismatch Found — Not Uploaded${detailsHtml}${errorHtml}`, false);
                    btn.innerHTML = originalHTML;
                    return;
                }

                if (data.success || data.statusCode === 200 || data.successFlag || (data.data && data.data.id)) {
                    await autoSelectFromOverview(overview);
                    let detailsHtml = '';
                    if (overview) {
                        const autoSelectLine = selectedMission ?
                            `<div class="ov-meta">🎯 Auto-selected: <b>${selectedMission}</b>${selectedCenter ? ' / <b>' + selectedCenter + '</b>' : ' (center না, dropdown থেকে বেছে নাও)'}</div>` :
                            '';
                        detailsHtml = `<div class="ov-item"><div class="ov-name">${overview.fullName || '-'}${overview.primary ? '<span class="ov-primary-badge">PRIMARY</span>' : ''}</div><div class="ov-meta">${overview.applicationId || '-'} | ${overview.passport || '-'}</div><div class="ov-meta">${overview.commissionName || '-'} | ${overview.visaType || '-'}</div>${autoSelectLine}</div>`;
                    }
                    setStatus(`✅ ${serverMsg}${detailsHtml}`, true);
                    btn.textContent = "Done";
                    btn.className = "modern-btn btn-done";
                    AudioManager.playBeep();

                } else {
                    setStatus(`❌ ${serverMsg}`, false);
                    btn.innerHTML = originalHTML;
                }
            } catch (e) {
                setStatus('❌ Network Error', false);
                btn.innerHTML = originalHTML;
            }
        }

        async function reuploadFile() {
            const select = document.getElementById('delete-file-select');
            const fileInput = document.getElementById('pdf-upload-reupload');
            const infoBar = document.getElementById('file-info-reupload');
            const btn = document.getElementById('btn-reupload');

            const webFileNumber = select.value;
            if (!webFileNumber) {
                setStatus('❌ Click Overview, then select a file to re-upload!', false);
                return;
            }
            if (!fileInput.files.length) {
                setStatus('❌ Choose the new PDF file!', false);
                return;
            }

            const file = fileInput.files[0];
            if (file.type !== 'application/pdf') {
                setStatus(`❌ ${file.name} not PDF`, false);
                return;
            }
            if (file.size > 500 * 1024) {
                setStatus(`❌ ${file.name} > 500KB`, false);
                return;
            }

            const matchedEntry = lastOverviewData.find(d => d.applicationId === webFileNumber);
            const isPrimary = matchedEntry ? !!matchedEntry.primary : false;

            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.textContent = "⏳...";
            select.disabled = true;

            const xToken = await ensureXToken();
            if (!xToken) {
                setStatus('❌ Captcha token পাওয়া যায়নি!', false);
                btn.innerHTML = originalHTML;
                btn.disabled = false;
                select.disabled = false;
                return;
            }
            const authToken = AuthManager.getToken();

            setLoading(`🔄 Re-uploading...`);
            try {
                const formData = new FormData();
                formData.append('files', file);
                formData.append('isPrimary', isPrimary ? 'true' : 'false');
                formData.append('webFileNumber', webFileNumber);

                const reuploadUrl = APIManager.get('uploadFile');
                const fetchPromise = fetch(reuploadUrl, {
                    method: "POST",
                    headers: {
                        "accept": "application/json, text/plain, */*",
                        "Authorization": `Bearer ${authToken}`,
                        "cache-control": "no-cache, no-store, must-revalidate",
                        "pragma": "no-cache",
                        "x-sec-runtime-state": getSecHeaders().runtime,
                        "x-token": xToken
                    },
                    referrer: "https://appointment.ivacbd.com/",
                    body: formData
                });


                const res = await fetchPromise;
                const data = await res.json();
                const serverMsg = data.message || "Done";
                const overview = data?.data?.overview || null;
                const errors = data?.data?.error || data?.error || data?.errors;

                const detailsHtml = overview ? `<div class="ov-item"><div class="ov-name">${overview.fullName || '-'}${overview.primary ? '<span class="ov-primary-badge">PRIMARY</span>' : ''}</div><div class="ov-meta">${overview.applicationId || '-'} | ${overview.passport || '-'}</div><div class="ov-meta">${overview.commissionName || '-'} | ${overview.visaType || '-'}</div></div>` : '';

                if (hasErrors(errors)) {
                    const errorList = toErrorList(errors);
                    const errorHtml = errorList.map(e => `<div class="err-item">⚠️ ${e}</div>`).join('');
                    setStatus(`❌ Mismatch Found — Not Re-uploaded${detailsHtml}${errorHtml}`, false);
                    btn.innerHTML = originalHTML;
                    btn.disabled = false;
                    select.disabled = false;
                    return;
                }

                if (data.success || data.statusCode === 200 || data.successFlag || (data.data && data.data.id)) {
                    await autoSelectFromOverview(overview);
                    setStatus(`✅ Re-uploaded${detailsHtml}`, true);
                    AudioManager.playBeep();

                    fileInput.value = '';
                    infoBar.textContent = ' 📂 New PDF File';
                    infoBar.classList.remove('has-file');
                    select.value = '';
                    btn.innerHTML = originalHTML;
                    btn.disabled = false;
                    select.disabled = false;
                    fetchOverviewData().then(r => {
                        if (r.data) populateFileSelects(r.data);
                    }).catch(() => {});
                } else {
                    setStatus(`❌ ${serverMsg}`, false);
                    btn.innerHTML = originalHTML;
                    btn.disabled = false;
                    select.disabled = false;
                }
            } catch (e) {
                setStatus('❌ Network Error', false);
                btn.innerHTML = originalHTML;
                btn.disabled = false;
                select.disabled = false;
            }
        }

        async function fetchOverviewData() {
            const authToken = AuthManager.getToken();
            const res = await fetch(APIManager.get('overview'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({})
            });
            return res.json();
        }

        function attachEvents() {

            const attendMappings = [
    { inputId: 'pdf-upload-attend-1', buttonId: 'btn-attend-1', name: 'S1' },
    { inputId: 'pdf-upload-attend-2', buttonId: 'btn-attend-2', name: 'S2' },
    { inputId: 'pdf-upload-attend-3', buttonId: 'btn-attend-3', name: 'S3' }
];

let clickedCount = 0;
attendMappings.forEach(mapping => {
    const fileInput = document.getElementById(mapping.inputId);
    const button = document.getElementById(mapping.buttonId);

    if (fileInput && fileInput.files && fileInput.files.length > 0) {
        if (button && !button.disabled) {
            button.click();  // ⚡ একসাথে, কোনো delay নেই
            clickedCount++;

        }
    } else {

    }
});


          //  document.getElementById('ts-x-refresh-btn').addEventListener('click', renderTurnstileWidget);

            document.getElementById('btn-clear-all')?.addEventListener('click', async () => {
                setLoading("🔄 Clearing all saved files...");
                await clearAllSavedFilesFromDB();
                if (window._ivacPersistActive) window._ivacPersistActive();
                ['pdf-upload-patent', 'pdf-upload-attend-1', 'pdf-upload-attend-2', 'pdf-upload-attend-3', 'pdf-upload-reupload'].forEach(id => {
                    const inp = document.getElementById(id);
                    if (inp) inp.value = '';
                });
                [
                    { id: 'file-info-patent', text: '📂 Primary File' },
                    { id: 'file-info-attend-1', text: '📂 S File 1' },
                    { id: 'file-info-attend-2', text: '📂 S File 2' },
                    { id: 'file-info-attend-3', text: '📂 S File 3' },
                    { id: 'file-info-reupload', text: '📂 New PDF File' }
                ].forEach(slot => {
                    const info = document.getElementById(slot.id);
                    if (info) {
                        info.textContent = slot.text;
                        info.classList.remove('has-file');
                        info.style.borderStyle = 'dashed';
                    }
                });
                ['btn-upload-1', 'btn-attend-1', 'btn-attend-2', 'btn-attend-3'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        btn.disabled = false;
                        btn.className = id === 'btn-upload-1' ? "modern-btn btn-patent" : "modern-btn btn-attend";
                        btn.innerHTML = id === 'btn-upload-1' ? "P" :
                                       id.includes('1') ? "S1" :
                                       id.includes('2') ? "S2" : "S3";
                    }
                });
                setStatus("🧹 All saved files cleared successfully!", true);
            });

            function wireFileInfo(inputId, infoId, placeholder, dbKey) {
                const input = document.getElementById(inputId);
                const infoBar = document.getElementById(infoId);
                if (!input || !infoBar) return;
                input.addEventListener('change', async (e) => {
                    if (e.target.files.length) {
                        const file = e.target.files[0];
                        infoBar.textContent = "⏳ Parsing Name...";
                        const applicantName = await extractNameFromPDF(file);
                        if (dbKey) await saveFileToDB(dbKey, file, applicantName);
                        //if (window._ivacPersistActive) window._ivacPersistActive();
                        const match = file.name.match(/BGD[A-Z0-9]{8,}/i);
                        const fileCode = match ? match[0].slice(0, 10) : file.name.slice(0, 8);
                        const displayName = applicantName ? `${applicantName}` : `${fileCode}`;
                        infoBar.textContent = displayName;
                        infoBar.classList.add('has-file');
                        infoBar.style.borderStyle = 'dashed';
                    } else {
                        infoBar.textContent = placeholder;
                        infoBar.classList.remove('has-file');
                    }
                });
            }

            wireFileInfo('pdf-upload-patent', 'file-info-patent', '  Primary File', 'patent');
            wireFileInfo('pdf-upload-attend-1', 'file-info-attend-1', ' S File 1', 'attend1');
            wireFileInfo('pdf-upload-attend-2', 'file-info-attend-2', ' S File 2', 'attend2');
            wireFileInfo('pdf-upload-attend-3', 'file-info-attend-3', ' S File 3', 'attend3');
            wireFileInfo('pdf-upload-reupload', 'file-info-reupload', ' New PDF File', null);

                        // ===== FILE SYNC BRIDGE: Dynamic tab <-> Manual tab (adjust) =====
            const SYNC_MAP = [
                { input: 'pdf-upload-patent',   adjKey: 'primary' },
                { input: 'pdf-upload-attend-1', adjKey: 'other1' },
                { input: 'pdf-upload-attend-2', adjKey: 'other2' },
                { input: 'pdf-upload-attend-3', adjKey: 'other3' }
            ];
            const ADJ_DB = 'IVAC_4_APPLICANTS_DB', ADJ_STORE = 'webfiles';
            const ADJ_MAX_SIZE = 500 * 1024;
            let syncBusy = false;

            function adjOpen() {
                return new Promise((resolve, reject) => {
                    const r = indexedDB.open(ADJ_DB, 1);
                    r.onupgradeneeded = e => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains(ADJ_STORE)) db.createObjectStore(ADJ_STORE);
                    };
                    r.onsuccess = () => resolve(r.result);
                    r.onerror = () => reject(r.error);
                });
            }

            async function adjWrite(fn) {
                const db = await adjOpen();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(ADJ_STORE, 'readwrite');
                    fn(tx.objectStore(ADJ_STORE));
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onerror = () => reject(tx.error);
                });
            }

            // Kafela -> Manual: ফাইল সিলেক্ট হলে Manual-এর DB-তে লিখবে
            async function mirrorToAdjust(map, file) {
                if (file.type !== 'application/pdf' || file.size > ADJ_MAX_SIZE) return;
                const record = {
                    name: file.name,
                    type: file.type || 'application/pdf',
                    size: file.size,
                    lastModified: file.lastModified,
                    data: await file.arrayBuffer()
                };
                await adjWrite(store => store.put(record, map.adjKey));
                document.dispatchEvent(new CustomEvent('ivac-files-changed', { detail: { source: 'kafela' } }));
            }

            async function removeFromAdjust(map) {
                await adjWrite(store => store.delete(map.adjKey));
                document.dispatchEvent(new CustomEvent('ivac-files-changed', { detail: { source: 'kafela' } }));
            }

            SYNC_MAP.forEach(map => {
                const input = document.getElementById(map.input);
                if (!input) return;
                input.addEventListener('change', async () => {
                    if (syncBusy) return;
                    try {
                        if (input.files.length) await mirrorToAdjust(map, input.files[0]);
                        else await removeFromAdjust(map);
                    } catch (err) {
                        console.error('[SYNC] Dynamic -> Manual failed:', err);
                    }
                });
            });

            // Manual -> Dynamic: Manual-এর DB দেখে Dynamic input আপডেট করবে
            function setDynamicInput(map, record) {
                const input = document.getElementById(map.input);
                const file = new File([record.data], record.name, {
                    type: record.type,
                    lastModified: record.lastModified
                });
                const dt = new DataTransfer();
                dt.items.add(file);
                syncBusy = true;
                try {
                    input.files = dt.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                } finally {
                    syncBusy = false;
                }
            }

            function clearDynamicInput(map) {
                const input = document.getElementById(map.input);
                if (!input || !input.files.length) return;
                syncBusy = true;
                try {
                    input.value = '';
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                } finally {
                    syncBusy = false;
                }
            }

            document.addEventListener('ivac-files-changed', async (e) => {
                if (e.detail?.source === 'kafela') return;
                try {
                    const db = await adjOpen();
                    for (const map of SYNC_MAP) {
                        const record = await new Promise(resolve => {
                            const req = db.transaction(ADJ_STORE, 'readonly')
                                          .objectStore(ADJ_STORE).get(map.adjKey);
                            req.onsuccess = () => resolve(req.result || null);
                            req.onerror = () => resolve(null);
                        });
                        const input = document.getElementById(map.input);
                        if (!input) continue;
                        if (record) {
                            if (!input.files.length || input.files[0].name !== record.name) {
                                setDynamicInput(map, record);
                            }
                        } else {
                            clearDynamicInput(map);
                        }
                    }
                    db.close();
                } catch (err) {
                    console.error('[SYNC] Manual -> Dynamic failed:', err);
                }
            });

            // "Clear pdf" বাটন: Manual-এর ফাইলও clear হবে
            document.getElementById('btn-clear-all')?.addEventListener('click', async () => {
                try {
                    await adjWrite(store => store.clear());
                    document.dispatchEvent(new CustomEvent('ivac-files-changed', { detail: { source: 'kafela' } }));
                } catch (err) {
                    console.error('[SYNC] Clear failed:', err);
                }
            });

            document.getElementById('btn-upload-1').addEventListener('click', () => uploadSingle(true, 'btn-upload-1', 'pdf-upload-patent', 'patent'));
            document.getElementById('btn-attend-1').addEventListener('click', () => uploadSingle(false, 'btn-attend-1', 'pdf-upload-attend-1', 'attend1'));
            document.getElementById('btn-attend-2').addEventListener('click', () => uploadSingle(false, 'btn-attend-2', 'pdf-upload-attend-2', 'attend2'));
            document.getElementById('btn-attend-3').addEventListener('click', () => uploadSingle(false, 'btn-attend-3', 'pdf-upload-attend-3', 'attend3'));
            document.getElementById('btn-reupload').addEventListener('click', reuploadFile);

            document.getElementById('btn-appointment').addEventListener('click', () => {
                document.getElementById('center-dropdown-wrapper').style.display = 'none';
                document.getElementById('delete-dropdown-wrapper').style.display = 'none';
               loadAppointmentContext();
            });

            document.getElementById('hc-city-select').addEventListener('change', (e) => selectMissionById(e.target.value));
            document.getElementById('ivac-center-select').addEventListener('change', (e) => selectCenterByName(e.target.value));

           document.getElementById('btn-booking-config').addEventListener('click', async () => {
    document.getElementById('center-dropdown-wrapper').style.display = 'none';
    document.getElementById('delete-dropdown-wrapper').style.display = 'none';
    const mission = selectedMission, center = selectedCenter;
    if (!mission || !center) {
        setStatus('❌ Select Mission & Center First!', false);
        return;
    }
    setLoading(`🔄 Config...`);
    try {
        const authToken = AuthManager.getToken();
        const res = await fetch(APIManager.get('bookingConfig'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ mission, ivacCenter: center })
        });
        const response = await res.json();

        // ✅ successFlag চেক করুন
        if (response.successFlag) {
            setStatus(`${response.message || '✅ Config Success'}`, true);
            AudioManager.playBeep();
        }
        else {
            setStatus(`❌ ${response.message || 'Config Failed'}`, false);
        }
    } catch (error) {
        setStatus(`❌ Error: ${error.message}`, false);
        console.error('Booking Config Error:', error);
    }
});

            document.getElementById('btn-overview').addEventListener('click', async () => {
                document.getElementById('center-dropdown-wrapper').style.display = 'none';
                document.getElementById('delete-dropdown-wrapper').style.display = 'block';
                setLoading('🔄 Overview...');
                try {
                    const response = await fetchOverviewData();
                    if (response.data && response.data.length) {
                        const rows = response.data.map(d => `<div class="ov-item"><div class="ov-name">${d.fullName || '-'}${d.primary ? '<span class="ov-primary-badge">PRIMARY</span>' : ''}</div><div class="ov-meta">${d.applicationId || '-'}</div><div class="ov-meta">${d.commissionName || '-'} | ${d.visaType || '-'}</div></div>`).join('');

                        //const rows = response.data.map(d => `<div class="ov-item"><div class="ov-name">${d.fullName || '-'}${d.primary ? '<span class="ov-primary-badge">PRIMARY</span>' : ''} | ${d.visaType || '-'}</div></div>`).join('');
                        setStatus(`✅ Total Files: ${response.data.length}${rows}`, true);
                        populateFileSelects(response.data);
                        AudioManager.playBeep();
                    } else {
                        setStatus(`${response.error}`, false);
                        populateFileSelects([]);
                    }
                } catch (error) {
                    setStatus(`❌ Error`, false);
                }
            });
        }

        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
        else createUI();
    }

    // ================================================================
    // 🎯 PART 7: SLOTBD TAB WITH FULL DYNAMIC API
    // ================================================================

    function runSlotBDTab(mountEl) {
        'use strict';

        // ─── DYNAMIC API MANAGER INSTANCE ──────────────────────────
        let dynamicApiManager = null;
        let cipherEnabled = false;
        let cipherFn = null;

        function initDynamicApiManager() {
            if (!dynamicApiManager) {
                dynamicApiManager = new EnhancedDynamicApiManager();
                const loaded = dynamicApiManager.loadSavedApi();
                if (loaded) {
                    console.log('[DynamicAPI] Loaded saved configuration');
                }
            }
            return dynamicApiManager;
        }

        // ─── CIPHER LOADER ──────────────────────────────────────────
     // ─── CIPHER LOADER ──────────────────────────────────────────
function loadCipherFromStorage() {
    try {
        const saved = localStorage.getItem('slotbd_enc_unified_script');
        console.log('[LOAD CIPHER] Script exists:', !!saved);

        if (saved && saved.trim()) {
            console.log('[LOAD CIPHER] Script length:', saved.length);
            console.log('[LOAD CIPHER] Creating cipher function...');

            // ✅ Just create the function - don't test it
            const fn = new Function('rawToken', 'purpose', `
                "use strict";
                ${saved}
                if (typeof encryptToken === 'function') return encryptToken(rawToken, purpose);
                if (typeof ProcessToken === 'function') return ProcessToken(rawToken, purpose);
                return rawToken;
            `);

            // ✅ Don't call fn('', '') - it will fail
            // fn('', '');  // ❌ DELETE THIS LINE

            cipherFn = fn;
            cipherEnabled = true;

            console.log('[LOAD CIPHER] ✅ Cipher loaded successfully');
            return true;
        }
    } catch (e) {
        console.error('[LOAD CIPHER] Error:', e.message);
    }

    cipherEnabled = false;
    cipherFn = null;
    console.log('[LOAD CIPHER] ❌ Failed to load cipher');
    return false;
}

function processSignin(rawToken) {
    if (cipherEnabled && cipherFn) {
        try {
            const result = cipherFn(rawToken, 'Signin');
            console.log('[CIPHER] Signin encrypted');
            return result;
        } catch (e) {
            console.error('[CIPHER] Signin encryption error:', e.message);
        }
    }
    return cryptCellular(rawToken, SigninKey, 5, 18, true);
}

function processReserve(rawToken) {
    if (cipherEnabled && cipherFn) {
        try {
            const result = cipherFn(rawToken, 'Reserve');
            console.log('[CIPHER] Reserve encrypted');
            return result;
        } catch (e) {
            console.error('[CIPHER] Reserve encryption error:', e.message);
        }
    }
    return cryptCellular(rawToken, ReserveKey, 5, 428, true);
}

loadCipherFromStorage();
        // ─── CONFIG ──────────────────────────────────────────────────
        const apiUrl = (key) => APIManager.get(key);

        let CONFIG = {
            phone: SharedProfile.phone || GM_getValue('ivac_phone', ''),
            password: SharedProfile.password || GM_getValue('ivac_password', ''),
            retryDelay: 20,
            maxAttempts: 103,
            autoCaptcha: true,
            captchaDelay: 15,
            retryEnabled: true,
            autoChain: false
        };

        try {
            const savedConfig = localStorage.getItem('slotbd-ui-config');
            if (savedConfig) CONFIG = { ...CONFIG, ...JSON.parse(savedConfig) };
            if (SharedProfile.phone) CONFIG.phone = SharedProfile.phone;
            if (SharedProfile.password) CONFIG.password = SharedProfile.password;
        } catch (e) {}

        SharedProfile.onChange((ph, pw) => {
            CONFIG.phone = ph;
            CONFIG.password = pw;
            const phoneEl = document.getElementById('sb-phone');
            const passEl = document.getElementById('sb-pass');
            if (phoneEl) phoneEl.value = ph;
            if (passEl) passEl.value = pw;
        });

        if (document.getElementById('slotbd-simple-panel')) return;

        let tokenPool = TokenPoolManager._pool;

        let otpPollerTimer = null;
        let currentClickId = 0;
        let stopAllFlag = false;

        let doVerifyInProgress = false;
        let pendingPayUrl = '';
        let tsWidgetId = null;
        let tsCollapsed = false;
        let configCollapsed = true;

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      function log(msg, type) {
            const el = document.getElementById('sb-msg');
            if (!el) return;
            const d = document.createElement('div');
            const c = { ok: '#14a800', err: '#e11d48', warn: '#d97706', info: '#64748b' };
            d.style.cssText = `color:${c[type] || '#64748b'};font-size:11px;line-height:1.6;`;
            d.textContent = msg;
            el.appendChild(d);
            el.scrollTop = el.scrollHeight;
        }

     function log(txt) {
            const el = document.getElementById('sb-msg');
            if (!el) return;
            el.textContent = txt;
            const isErr = txt.startsWith('❌') || txt.startsWith('⚠') || txt.toLowerCase().includes('error') ||
                          txt.toLowerCase().includes('fail') || txt.toLowerCase().includes('cancel');
            const isOk = txt.startsWith('✅') || txt.toLowerCase().includes('ready') ||
                         txt.toLowerCase().includes('received') || txt.toLowerCase().includes('verified') ||
                         txt.toLowerCase().includes('ok');
            el.style.borderLeftColor = isErr ? '#e11d48' : isOk ? '#14a800' : '#d1d5db';
            el.style.color = isErr ? '#e11d48' : isOk ? '#14a800' : '#374151';
        }
        function showPayLink(url) {
            pendingPayUrl = url;
            const box = document.getElementById('sb-paybox');
            if (!box) return;
            const urlEl = document.getElementById('sb-payurl');
            urlEl.textContent = url;
            urlEl.title = url;
            document.getElementById('sb-copy').textContent = 'Copy';
            box.style.display = 'block';
            window.open(url, '_blank');

            try {
                const idx = parseInt(ProfileManager._lastIdx);
                if (!isNaN(idx)) {
                    const profiles = ProfileManager.load();
                    if (profiles[idx]) {
                        profiles[idx].webviewUrl = url;
                        ProfileManager.save(profiles);
                        log(`webview_url saved to profile[${idx}]`, 'ok');
                    }
                }
            } catch (e) {
                console.warn('[IVAC] webviewUrl save failed:', e);
            }
        }

        function setOtpBtn(state) {
            const btn = document.getElementById('sb-getotp');
            if (!btn) return;
            const map = {
                searching: { text: 'Stop', bg: '#e11d48', color: '#fff', bd: '#e11d48' },
                found: { text: 'Found!', bg: '#14a800', color: '#fff', bd: '#14a800' },
                idle: { text: 'Get OTP', bg: '#fff', color: '#374151', bd: '#d1d5db' },
            };
            const s = map[state] || map.idle;
            Object.assign(btn.style, { background: s.bg, color: s.color, borderColor: s.bd });
            btn.textContent = s.text;
            if (state === 'found') setTimeout(() => setOtpBtn('idle'), 3000);
        }

        function updateBadge() {
            const cnt = TokenPoolManager.count();
            const badge = document.getElementById('sb-ts-badge');
            if (!badge) return;
            badge.textContent = cnt;
            badge.className = 'sb-badge' + (cnt > 0 ? ' green' : '');
        }

               // ─── API Request with retry ──────────────────────────────
        async function ivacReq(url, method, data = null, actionName = "Request", _try = 0) {
            if (stopAllFlag) return null;
            const myId = currentClickId;

            const doRetry = async (reason, customDelay = null) => {
                if (stopAllFlag || !CONFIG.retryEnabled || myId !== currentClickId) return null;
                if (_try >= CONFIG.maxAttempts - 1) {
                    log(`Max retries! [${actionName}] ${reason}`, 'err');
                    return null;
                }
                const next = _try + 1;
                let delay = customDelay;
                if (delay === null) delay = CONFIG.retryDelay;
                log(`${actionName} ${next} ${reason} (retry in ${delay}s)`, 'warn');
                await sleep(delay * 1000);
                if (stopAllFlag || myId !== currentClickId) return null;
                return ivacReq(url, method, data, actionName, next);
            };

            try {
                const sec = getSecHeaders();
                const headers = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'x-v-request-meta': sec.meta,
                    'x-sec-navigation-state': sec.nav
                };
                const authToken = AuthManager.getToken();
                if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

                // ✅ Dynamic headers inject করো
                try {
                    const savedHeaders = JSON.parse(localStorage.getItem('ivac_api_headers') || '{}');
                    const urlPath = url.replace(APIManager.get('baseApi') || 'https://api.ivacbd.com/iams/api/v1', '');
                    const endpointPaths = window.__IVAC?.dynamicApi?.constants?._endpointPaths || {};

                    for (const [fnName, ep] of Object.entries(endpointPaths)) {
                        if (ep.path && urlPath.startsWith(ep.path.split('${')[0].split('?')[0])) {
                            const fnHeaders = savedHeaders[fnName] || [];
                            for (const h of fnHeaders) {
                                if (h === 'x-token') {
                                    const xToken = window.__IVAC?.auth?.xToken || localStorage.getItem('ivac_x_token') || '';
                                    if (xToken) headers['x-token'] = xToken;
                                }
                                if (h === 'x-sec-runtime-state' && sec.runtime) headers['x-sec-runtime-state'] = sec.runtime;
                                if (h === 'x-sec-navigation-state') headers['x-sec-navigation-state'] = sec.nav;
                                if (h === 'x-v-request-meta') headers['x-v-request-meta'] = sec.meta;
                            }
                            break;
                        }
                    }
                } catch (e) {}

                const opts = { method, headers };
                if (data && (method === 'POST' || method === 'PUT')) opts.body = JSON.stringify(data);

                const response = await fetch(url, opts);
                let result = {};
                try { result = await response.json(); } catch (e) {}

                if (response.status === 401) {
                    log('401 Unauthorized! Stopped.');
                    log(`[401] Unauthorized — ${actionName} — Stopped.`, 'err');
                    return null;
                }
                if (response.status === 502 || response.status === 504) {
                    const msg = result?.message || result?.data?.message || response.statusText || 'Server Error';
                    return await doRetry(`[${response.status}] ${msg}`, 1.0);
                }
                if ([400, 500, 501, 502, 503, 504].includes(response.status)) {
                    const msg = result?.message || result?.data?.message || response.statusText || '';
                    return await doRetry(`[${response.status}] ${msg}`, null);
                }
                return { ok: response.ok, status: response.status, data: result };
            } catch (err) {
                if (stopAllFlag) {
                    log(`Stopped! [${actionName}]`, 'err');
                    return null;
                }
                return await doRetry(err.message || 'Failed to fetch', null);
            }
        }


        // ─── OTP Functions ──────────────────────────────────────────
        function sbWordsToDigits(text) {
            const map = {
                zero:'0', one:'1', two:'2', three:'3', four:'4',
                five:'5', six:'6', seven:'7', eight:'8', nine:'9'
            };
            return text.toLowerCase().replace(/-/g,' ').replace(
                /\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/g,
                m => map[m]
            );
        }

        function sbToBengaliDigits(text) {
            const map = {'০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9'};
            return text.replace(/[০-৯]/g, d => map[d]);
        }

        function sbExtractOtp(rawText) {
            const normalized = sbToBengaliDigits(String(rawText||''));
            let otp = '';
            try {
                const data = JSON.parse(normalized);
                const val = String(data.otp||data.code||data.sms||data.message||data.token||data.text||data.body||'');
                otp = sbWordsToDigits(sbToBengaliDigits(val)).replace(/\s+/g,'').replace(/\D/g,'').slice(0,6);
                if (otp.length < 6) {
                    const full = sbWordsToDigits(normalized).replace(/\s+/g,'');
                    const cleaned = full.replace(/\d{11}/g,'X');
                    const match = cleaned.match(/\d{6}/);
                    otp = match ? match[0] : '';
                }
            } catch {
                const converted = sbWordsToDigits(normalized).replace(/\s+/g,'');
                const cleaned = converted.replace(/\d{11}/g,'X');
                const match = cleaned.match(/\d{6}/);
                otp = match ? match[0] : '';
            }
            return otp.length === 6 ? otp : '';
        }

        // ─── Actions using Dynamic API ─────────────────────────────

        async function doSignin() {
            const phone = document.getElementById('sb-phone').value.trim();
            const pass = document.getElementById('sb-pass').value.trim();
            if (!phone || !pass) {
                log('Enter phone and password.', 'warn');
                return;
            }

            CONFIG.phone = phone;
            CONFIG.password = pass;
            saveUIConfig();
            currentClickId++;
            if (!CONFIG.autoChain) stopAllFlag = false;

            log('Signin started...', 'info');
            log('Waiting for captcha token...');
            const token = await TokenPoolManager.waitForToken();
            if (!token) {
                log('No captcha token!');
                return;
            }

            log('Signing in...');

           let result = await ivacReq(
    apiUrl('signin'),
    'POST',
    { phone, password: pass, c: processSignin(token) },
    'Signin'
);

            if (!result) { log('No response!'); return; }

         const d = result?.data?.data || result?.data, code = result?.data?.statusCode || result?.status || 200, msg = result?.data?.message || result?.message || '';

            if (result?.ok && d?.requestId) {
                window.__IVAC.auth.requestId = d.requestId;
                AuthManager.setToken(d.accessToken || d.token || AuthManager.getToken(), {
                    userId: d.userId,
                    requestId: d.requestId,
                    phone: phone,
                    expiresAt: d.expiresAt || 899,
                    isVerified: false
                });
                log(`[${code}] ${msg || 'OTP sent!'}`);
                log(`Signin OK! OTP incoming...`, 'ok');
                AudioManager.playBeep();
                const receivedOtp = await startOtpPoller(phone);
                if (CONFIG.autoChain && receivedOtp && !stopAllFlag) {
                    log('[Auto Chain] Starting OTP verification...', 'info');
                    await doVerify();
                }
            } else {
                log(`[${code}] ${msg || 'Signin failed'}`);
                log(`[${code}] ${msg}`, 'err');
            }
        }

          function startOtpPoller(phone) {
            return new Promise((resolve) => {
                if (otpPollerTimer) {
                    clearInterval(otpPollerTimer);
                    otpPollerTimer = null;
                }
                setOtpBtn('searching');
                log('Searching for OTP...', 'info');
                log('Searching for OTP...');

                let attempts = 0;
                const MAX = 300;
                const otpUrl = apiUrl('otpPoller');
                let otpFound = false;  // ✅ নতুন flag - একবার OTP পেলে আর poll হবে না

                otpPollerTimer = setInterval(() => {
                    if (stopAllFlag || otpFound) {  // ← otpFound check যোগ করা
                        clearInterval(otpPollerTimer);
                        otpPollerTimer = null;
                        setOtpBtn('idle');
                        resolve(null);
                        return;
                    }

                    attempts++;

                    if (typeof GM_xmlhttpRequest !== 'undefined') {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: `${otpUrl}?phone=${phone}`,
                            onload: function(response) {
                                try {
                                    const data = JSON.parse(response.responseText);
                                    if (data?.otp) {
                                        otpFound = true;  // ✅ Flag set করুন
                                        clearInterval(otpPollerTimer);
                                        otpPollerTimer = null;
                                        const rawOtp = String(data.otp || '');
                                        const cleanOtp = sbExtractOtp(rawOtp);
                                        const finalOtp = cleanOtp || rawOtp;
                                        const otpInput = document.getElementById('sb-otp');
                                        otpInput.value = finalOtp;
                                        otpInput.dispatchEvent(new Event('input', { bubbles: true }));

                                        setOtpBtn('found');
                                        AudioManager.playBeep();
                                        log(`OTP received: ${finalOtp}`, 'ok');
                                        log(`✅ OTP: ${finalOtp}`);
                                        resolve(data.otp);
                                    } else if (attempts >= MAX) {
                                        clearInterval(otpPollerTimer);
                                        otpPollerTimer = null;
                                        setOtpBtn('idle');
                                        log('OTP not found within time limit.', 'err');
                                        log('⏰ OTP timeout — manually enter.');
                                        resolve(null);
                                    }
                                } catch (e) {
                                    if (attempts >= MAX) {
                                        clearInterval(otpPollerTimer);
                                        otpPollerTimer = null;
                                        setOtpBtn('idle');
                                        log('OTP fetch error.');
                                        resolve(null);
                                    }
                                }
                            },
                            onerror: function() {
                                if (attempts >= MAX) {
                                    clearInterval(otpPollerTimer);
                                    otpPollerTimer = null;
                                    setOtpBtn('idle');
                                    log('OTP fetch error.');
                                    resolve(null);
                                }
                            }
                        });
                    }
                }, 500);
            });
        }



        async function doGetOtp() {
            const phone = document.getElementById('sb-phone').value.trim();
            if (!phone) {
                log('Enter phone number.', 'warn');
                return;
            }
            if (otpPollerTimer) {
                clearInterval(otpPollerTimer);
                otpPollerTimer = null;
                setOtpBtn('idle');
                log('OTP search stopped by user.', 'warn');
                log('OTP search stopped.');
                return;
            }
            log('Searching for OTP...');
            startOtpPoller(phone);
        }

        async function doVerify() {
            const rawOtpVal = document.getElementById('sb-otp').value.trim();
            const otp = sbExtractOtp(rawOtpVal) || rawOtpVal;
            const phone = document.getElementById('sb-phone').value.trim();
            if (!otp) {
                log('Enter OTP.', 'warn');
                return;
            }
            if (otpPollerTimer) {
                clearInterval(otpPollerTimer);
                otpPollerTimer = null;
                setOtpBtn('idle');
            }

            log('Verifying OTP...');
            log(`Verifying OTP: ${otp}`, 'info');

            let result = await ivacReq(
    apiUrl('verifyOtp'),
    'POST',
    { requestId: window.__IVAC.auth.requestId, phone, code: otp, otpChannel: 'PHONE' },
    'Verify'
);
            if (!result) { log('No response!'); return; }

            const code = result?.data?.statusCode || result?.status || 200, msg = result?.data?.message || result?.message || '';
const verified = result?.data?.data?.verified === true || result?.data?.verified === true;
if (result?.ok && verified) {
    const token = result?.data?.data?.accessToken || result?.data?.data?.token || result?.data?.accessToken || AuthManager.getToken();
                AuthManager.setToken(token, { isVerified: true, requestId: null });
                AudioManager.playBeep();


                log(`[${code}] ${msg || 'OTP Verified!'}`);
               // log(`OTP Verified! Token active.`, 'ok');
                if (CONFIG.autoChain && !stopAllFlag) {
                    log('[Auto Chain] Reserving slot...', 'info');
                    await doReserve();
                }
            } else {
              log(`[${code}] ${result?.data?.data?.verificationStatus || msg || ''}`);
                log(`[${code}] ${msg}`, 'err');
            }
        }

        async function doReserve() {
            if (!CONFIG.autoChain) currentClickId++;
            if (!CONFIG.autoChain) stopAllFlag = false;

            log('Reserve Slot started...', 'info');
            log('Waiting for captcha token...');
            const raw = await TokenPoolManager.waitForToken();
            if (!raw) {
                log('No captcha token!');
                return;
            }
            const token = processReserve(raw);

            const dateSel = document.getElementById('sb-date-select');
            const selectedDate = dateSel?.value || window.__IVAC.auth.selectedDate || '';
            if (dateSel) window.__IVAC.auth.selectedDate = selectedDate;

            log('Reserving slot...');

            let result = await ivacReq(
    apiUrl('reserveSlot'),
    'POST',
    { c: token, appointmentDate: selectedDate },
    'Reserve Slot'
);

            if (!result) { log('No response!'); return; }

            const st = result?.data?.data?.status || result?.data?.status || '', msg = result?.data?.message || result?.message || '', code = result?.data?.statusCode || result?.status || 200;
const reservationId = result?.data?.data?.reservationId || result?.data?.reservationId;
if (result?.ok && (st === 'OK_NEW' || st === 'RESERVED' || reservationId)) {
    window.__IVAC.auth.reservationId = reservationId || result?.data?.data?.id || result?.data?.id;
                AudioManager.playBeep();
                log(`[${code}] [${st}] ${msg}`);
               // log('Slot Reserved! Proceed to Get Booking.', 'ok');
                if (CONFIG.autoChain && !stopAllFlag) {
                    log('[Auto Chain] Getting booking ID...', 'info');
                    await doGetBooking();
                }
            } else {
                log(`[${code}] [${st}] ${msg || 'Reserve failed'}`);
                log(`[${code}] [${st}] ${msg}`, 'err');
                const noRetryStatuses = ['OK_NEW', 'RESERVED'];
                if (CONFIG.retryEnabled && !stopAllFlag && !noRetryStatuses.includes(st)) {
                    const delay = CONFIG.retryDelay || 20;
                    log(`Retrying in ${delay}s...`, 'warn');
                    log(`[${code}] [${st}] ${msg}`);
                    await sleep(delay * 1000);
                    if (!stopAllFlag) await doReserve();
                }
            }
        }

        const CACHE_TTL = 6 * 60 * 60 * 1000;

        function saveAppointmentCache(appId, appDate) {
            try {
                localStorage.setItem('ivac-appointment-cache', JSON.stringify({
                    appointmentId: appId,
                    appointmentDate: appDate,
                    expiry: Date.now() + CACHE_TTL
                }));
            } catch (e) {}
        }

        function loadAppointmentCache() {
            try {
                const raw = localStorage.getItem('ivac-appointment-cache');
                if (!raw) return null;
                const cacheData = JSON.parse(raw);
                if (Date.now() > cacheData.expiry) {
                    localStorage.removeItem('ivac-appointment-cache');
                    return null;
                }
                return cacheData;
            } catch (e) { return null; }
        }

async function doGetBooking() {
    if (!CONFIG.autoChain) currentClickId++;
    if (!CONFIG.autoChain) stopAllFlag = false;
    log('Fetching booking config...');
    log('Get Booking started...', 'info');

    let result = await ivacReq(apiUrl('getBooking'), 'GET', null, 'Get Booking');
    console.log('[DEBUG] getBooking result:', JSON.stringify(result)); // ← এটা যোগ করুন

    if (!result) { log('No response!'); return null; }

   const code = result?.data?.statusCode || result?.status || 200, msg = result?.data?.message || result?.message || '';
   const appId = result?.data?.data?.appointmentId || result?.data?.appointmentId;

    if (appId) {
        window.__IVAC.auth.appointmentId = appId;
        const apptInput = document.getElementById('sb-appt-id');
        if (apptInput) apptInput.value = appId;

       const dates = result?.data?.data?.appointmentDate || result?.data?.appointmentDate || [];
        const dateSel = document.getElementById('sb-date-select');
        if (dateSel) {
            dateSel.innerHTML = '';
            if (dates.length > 0) {
                dates.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d;
                    opt.textContent = d;
                    dateSel.appendChild(opt);
                });
                dateSel.style.display = 'block';
                const dateLbl = document.getElementById('sb-date-lbl');
                if (dateLbl) dateLbl.style.display = 'block';
                window.__IVAC.auth.selectedDate = dates[0];
                log(`Dates available: ${dates.join(', ')}`, 'ok');
            } else {
                dateSel.style.display = 'none';
            }
        }

        saveAppointmentCache(appId, window.__IVAC.auth.selectedDate || (dates.length > 0 ? dates[0] : ''));
        AudioManager.playBeep();
        log(`Booking ID: ${appId}`);
        log(`Appointment ID received & Saved (6h): ${appId}`, 'ok');

        if (CONFIG.autoChain && !stopAllFlag) {
            log('[Auto Chain] Initiating DG Pay...', 'info');
            await doDGPay();
        }
        return appId;
    } else {
        log(`[${code}] ${msg || 'Booking ID not found'}`);
        log(`[${code}] Failed to get Booking ID.`, 'err');
        return null;
    }
}

        const cachedApp = loadAppointmentCache();
        if (cachedApp) {
            if (cachedApp.appointmentId) {
                window.__IVAC.auth.appointmentId = cachedApp.appointmentId;
                const apptInput = document.getElementById('sb-appt-id');
                if (apptInput) apptInput.value = cachedApp.appointmentId;
            }
            if (cachedApp.appointmentDate) window.__IVAC.auth.selectedDate = cachedApp.appointmentDate;
            log(`Restored valid 6h Appointment ID: ${cachedApp.appointmentId}`, 'info');
        }

        async function doDGPay() {
            const inputVal = document.getElementById('sb-appt-id')?.value.trim();
            if (inputVal) window.__IVAC.auth.appointmentId = inputVal;

            let appointmentId = window.__IVAC.auth.appointmentId;

            log('Waiting for Turnstile token...');
            const rawToken = await TokenPoolManager.waitForToken();
            if (!rawToken) {
                log('No captcha token available for DG Pay!');
                log('DG Pay cancelled: Missing captcha token.', 'err');
                return;
            }

            log('Initiating DG-ePay...');
            log(`DG Pay started... ID: ${appointmentId}`, 'info');

          let result = null;
try {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'x-token': rawToken
    };
    const authToken = AuthManager.getToken();
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(apiUrl('dgPay'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ appointmentId })
    });
    try {
        const data = await res.json();
        result = data;
    } catch (e) {
        const text = await res.text();
        const match = text.match(/showPaymentPopup\(['"](.+?)['"]\)/);
        result = { success: res.ok, data: { webview_url: match ? match[1] : null } };
    }
} catch (e) {
    log(`DG Pay error: ${e.message}`, 'err');
    result = { success: false, message: e.message };
}

const gatewayUrl = result?.data?.webview_url || result?.data?.GatewayPageURL || null;
if (result.success !== false && gatewayUrl) {
    AudioManager.playBeep();
    log('DG Pay Link Ready');
    log('DG Pay link received.', 'ok');
    showPayLink(gatewayUrl);
    if (CONFIG.autoChain) log('[Auto Chain] Full sequence completed!', 'ok');
} else {
    log(`DG-ePay URL not found`);
    log(`DG Pay failed (${result?.message || 'Unknown error'})`, 'err');
}
        }
        function saveUIConfig() {
            try { localStorage.setItem('slotbd-ui-config', JSON.stringify(CONFIG)); } catch (e) {}
        }
        // ─── Render Turnstile ──────────────────────────────────────
        function renderTurnstile() {
            const container = document.getElementById('sb-ts-widget');
            Object.assign(container.style, {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0px 0px', margin: '0px 0px', width: '100%', boxSizing: 'border-box',
                background: '#ffffff', borderRadius: '8px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
            });
            if (!container) return;

            TurnstileManager.render(container, () => {
                updateBadge();
                if (CONFIG.autoCaptcha) {
                    const cDelay = parseFloat(document.getElementById('cfg-captcha-delay')?.value) || CONFIG.captchaDelay;
                    setTimeout(renderTurnstile, cDelay * 1000);
                }
            }, () => {
                log('Turnstile error', 'err');
                if (CONFIG.autoCaptcha) {
                    const cDelay = parseFloat(document.getElementById('cfg-captcha-delay')?.value) || CONFIG.captchaDelay;
                    setTimeout(renderTurnstile, cDelay * 1000);
                }
            }, () => {
                log('Token expired', 'warn');
                if (CONFIG.autoCaptcha) {
                    const cDelay = parseFloat(document.getElementById('cfg-captcha-delay')?.value) || CONFIG.captchaDelay;
                    setTimeout(renderTurnstile, cDelay * 1000);
                }
            });
        }

        // ─── Create UI ──────────────────────────────────────────────
        function createUI() {
            const panel = document.createElement('div');
            panel.id = 'slotbd-simple-panel';

            panel.innerHTML = `
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
                    #slotbd-simple-panel { position: relative; width: 100%; background: transparent; border: none; border-radius: 0; box-shadow: none; font-family: 'Inter', sans-serif; overflow: visible; }
                    #slotbd-simple-panel * { box-sizing: border-box; font-family: 'Inter', sans-serif; }
                    #sb-top-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
                    #sb-top-row .sb-htitle { font-size: 13px; font-weight: 700; color: #0f172a; }
                    #sb-body { padding: 0; }
                    .sb-lbl { font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: .7px; margin-bottom: 4px; margin-top: 6px; display: block; text-align: left; }
                    .sb-lbl:first-child { margin-top: 0; }
                    #sb-ts-card { border: 1px solid #e2e8f0; border-radius: 4px; overflow: hidden; background: #f9fafb; margin-bottom: 4px; }
                    #sb-ts-topbar { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-bottom: 1px solid #eef0f3; background: #fff; }
                    .ts-lbl { font-size: 12px; font-weight: 600; color: #374151; flex: 1; }
                    .ts-refbtn { background: #f3f4f6; border: 1px solid #e2e8f0; border-radius: 4px; color: #6b7280; font-size: 11px; font-weight: 600; padding: 0 8px; height: 23px; cursor: pointer; transition: all .15s; }
                    .ts-refbtn:hover { background: #fff; border-color: #14a800; color: #14a800; }
                    .sb-badge { background: #e2e8f0; color: #9ca3af; border-radius: 4px; font-size: 10px; font-weight: 700; padding: 2px 8px; min-width: 22px; text-align: center; transition: all .2s; }
                    .sb-badge.green { background: #14a800; color: #fff; }
                    .ts-colbtn { background: none; border: none; color: #9ca3af; font-size: 11px; cursor: pointer; padding: 0; }
                    #sb-ts-body { padding: 0; display: flex; align-items: center; justify-content: center; background: #f9fafb; height: 50px; overflow: hidden; }
                    #sb-ts-widget { display: flex; justify-content: center; align-items: center; width: 100%; transform: scale(0.7); transform-origin: center center; }
                    #sb-config-modal-overlay { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.45); z-index:2147483648; align-items:center; justify-content:center; }
                    #sb-config-modal-overlay.open { display:flex; }
                    #sb-config-card { background:#fff; border:1px solid #e2e8f0; border-radius:4px; padding:16px; width:280px; max-width:94vw; box-shadow:0 20px 60px rgba(0,0,0,0.25); }
                    #sb-config-modal-title { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
                    #sb-config-modal-title span { font-size:13px; font-weight:700; color:#1e293b; }
                    #sb-config-close-btn { background:none; border:none; font-size:16px; cursor:pointer; color:#64748b; line-height:1; }
                    .config-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
                    .config-row label { font-size: 11px; color: #475569; font-weight: 500; }
                    .config-inp { width: 70px; height: 24px; text-align: center; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 4px; outline: none; }
                    .config-chk { accent-color: #14a800; cursor: pointer; }
                    #sb-save-config-btn { background: #14a800; color: #fff; border: none; width: 100%; height: 24px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer; margin-top: 4px; }
                    #sb-save-config-btn:hover { background: #119900; }
                    #sb-auth-card { background: #f9fafb; border: 1px solid #e2e8f0; border-radius: 4px; padding: 3px; margin-bottom: 4px; }
                    .sb-grid-row { display: grid; grid-template-columns: 1fr 1fr 80px; gap: 2px; margin-bottom: 6px; }
                    .sb-grid-row:last-child { margin-bottom: 0; }
                    .sb-inp { width: 100%; height: 30px; background: #fff; border: 1px solid #e2e8f0; border-radius: 4px; color: #111827; padding: 0 5px; font-size: 12px; outline: none; transition: border-color .15s, box-shadow .15s; }
                    .sb-inp::placeholder { color: #b0b7c3; font-size: 12px; }
                    .sb-inp:focus { border-color: #14a800; box-shadow: 0 0 0 3px rgba(20,168,0,0.09); }
                    .sb-btn { height: 30px; width: 100%; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 12px; border: 1px solid transparent; display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; transition: all .15s; }
                    .sb-btn:active { transform: scale(.97); }
                    .sb-green { background: #14a800; color: #fff; border-color: #14a800; }
                    .sb-green:hover { background: #1a5a49; }
                    .sb-white { background: #fff; color: #374151; border-color: #d1d5db; }
                    .sb-white:hover { border-color: #14a800; color: #14a800; }
                    .sb-full { flex: 1; height: 30px; }
                    #sb-actions { display: flex; gap: 2px; }
                    .sb-sep { border: none; border-top: 1px solid #f1f5f9; margin: 5px 0; }
                    #sb-msg { justify-content: center; text-align: center; background: #e6e8e9; min-height: 60px; border: 1px solid #e2e8f0; border-left: 3px solid #d1d5db; border-radius: 4px; padding: 10px 11px; font-size: 12px; font-weight: 500; color: #374151; display: flex; align-items: center; line-height: 1.4; margin-bottom: 6px; transition: border-color .2s, color .2s; }
                    #sb-paybox { display: none; background: #f0fdf4; border: 1px solid #86efac; border-radius: 4px; padding: 6px 8px; margin-bottom: 5px; }
                    .pay-row { display: flex; align-items: center; gap: 5px; height: 28px; }
                    .pay-ttl { font-size: 10px; font-weight: 700; color: #14a800; white-space: nowrap; flex-shrink: 0; letter-spacing: .3px; }
                    .pay-url { flex: 1; font-size: 10px; color: #374151; font-family: monospace; background: #fff; border: 1px solid #d1fae5; border-radius: 4px; padding: 0 6px; height: 24px; line-height: 24px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; cursor: text; transition: box-shadow .15s; }
                    .pay-url:hover { box-shadow: 0 0 0 2px rgba(20,168,0,0.15); }
                    .pay-open { flex-shrink: 0; height: 24px; padding: 0 9px; border: 1px solid #14a800; border-radius: 4px; background: #14a800; color: #fff; font-weight: 600; font-size: 11px; cursor: pointer; white-space: nowrap; }
                    .pay-open:hover { background: #119900; }
                    .pay-copy { flex-shrink: 0; height: 24px; padding: 0 9px; border: 1.5px solid #86efac; border-radius: 4px; background: #fff; color: #14a800; font-weight: 600; font-size: 11px; cursor: pointer; white-space: nowrap; }
                    .pay-copy:hover { border-color: #14a800; }

                    .dapi-row {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        padding: 6px 8px;
                        margin: 8px 0;
                        background: #f0fdf4;
                        border: 1px solid #86efac;
                        border-radius: 4px;
                    }
                    .dapi-row .dapi-label {
                        font-size: 10px;
                        font-weight: 700;
                        white-space: nowrap;
                        width: 75px;
                        flex-shrink: 0;
                        text-align: left;
                        border: 1px solid #bfdbfe;
                        border-radius: 4px;
                        padding: 4px 6px;
                        background: #eff6fe;
                        color: #0369a1;
                        box-sizing: border-box;
                    }
                    .dapi-row .dapi-input {
                        flex: 1;
                        height: 28px;
                        padding: 0 8px;
                        font-size: 10px;
                        font-family: monospace;
                        border: 1px solid #e2e8f0;
                        border-radius: 4px;
                        outline: none;
                        box-sizing: border-box;
                        color: #1e293b;
                        background: #f8fafc;
                    }
                    .dapi-row .dapi-input:focus {
                        border-color: #22c55e;
                        box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.1);
                    }
                    .dapi-row .dapi-fetch-btn {
                        height: 28px;
                        padding: 0 12px;
                        background: #7c3aed;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        font-size: 10px;
                        font-weight: 700;
                        cursor: pointer;
                        flex-shrink: 0;
                        transition: all 0.15s ease;
                    }
                    .dapi-row .dapi-fetch-btn:hover {
                        background: #6d28d9;
                        transform: scale(1.02);
                    }
                    .dapi-row .dapi-fetch-btn:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                        transform: none;
                    }
                    .dapi-row .dapi-status {
                        font-size: 9px;
                        color: #94a3b8;
                        min-width: 50px;
                        text-align: right;
                    }
                    .dapi-row .dapi-status.ok { color: #22c55e; }
                    .dapi-row .dapi-status.error { color: #ef4444; }
                    .dapi-row .dapi-status.loading { color: #f59e0b; }

                    #sb-api-modal-slotbd {
                        display: none;
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        width: 310px;
                        max-height: 90vh;
                        background: #ffffff;
                        z-index: 2147483647;
                        padding: 10px;
                        overflow-y: auto;
                        box-sizing: border-box;
                        border-radius: 4px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.25);
                        border: 1px solid #e2e8f0;
                        font-family: system-ui, sans-serif;
                    }
                    #sb-api-modal-slotbd .api-tab {
                        flex: 1;
                        padding: 8px;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: 600;
                        font-size: 12px;
                        transition: all 0.2s;
                    }
                    #sb-api-modal-slotbd .api-tab.active {
                        background: #22c55e;
                        color: #ffffff;
                    }
                    #sb-api-modal-slotbd .api-tab:not(.active) {
                        background: #e2e8f0;
                        color: #1e293b;
                    }
                    #sb-api-modal-slotbd .api-tab-content {
                        display: none;
                    }
                    #sb-api-modal-slotbd .api-tab-content.active {
                        display: block;
                    }
                    #sb-api-modal-slotbd textarea {
                        width: 100%;
                        min-height: 120px;
                        padding: 8px;
                        font-family: monospace;
                        font-size: 11px;
                        border: 1px solid #cbd5e1;
                        border-radius: 4px;
                        box-sizing: border-box;
                        resize: vertical;
                    }
                    #sb-api-detected-list {
                        display: grid;
                        grid-template-columns: 1fr;
                        gap: 4px;
                        max-height: 150px;
                        overflow-y: auto;
                    }
                    #sb-api-detected-list::-webkit-scrollbar {
                        width: 3px;
                    }
                    #sb-api-detected-list::-webkit-scrollbar-thumb {
                        background: #d1d5db;
                        border-radius: 4px;
                    }
                    #sb-api-detection-status {
                        display: none;
                        padding: 10px;
                        border-radius: 4px;
                        margin-bottom: 10px;
                        font-size: 11px;
                        line-height: 1.5;
                    }
                    #sb-api-info {
                        padding: 10px;
                        background: #eff6ff;
                        border: 1px solid #bfdbfe;
                        border-radius: 4px;
                        font-size: 10px;
                        color: #0369a1;
                        line-height: 1.6;
                        max-height: 100px;
                        overflow-y: auto;
                    }
                    .endpoint-detail {
                        font-size: 9px;
                        color: #64748b;
                        margin-top: 2px;
                    }
                    .endpoint-detail .badge-header {
                        display: inline-block;
                        background: #e0e7ff;
                        color: #4338ca;
                        padding: 0 6px;
                        border-radius: 4px;
                        font-size: 8px;
                        font-weight: 700;
                    }
                    .endpoint-detail .badge-payload {
                        display: inline-block;
                        background: #fce7f3;
                        color: #be185d;
                        padding: 0 6px;
                        border-radius: 4px;
                        font-size: 8px;
                        font-weight: 700;
                    }
                </style>

                <!-- Cipher Modal -->
                <div id="sb-cipher-modal" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); width:320px; max-height:80vh; background:#fff; z-index:2147483647; padding:14px; overflow-y:auto; box-sizing:border-box; border-radius:4px; box-shadow:0 20px 60px rgba(0,0,0,0.25); border:1px solid #e2e8f0;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <span style="font-size:13px; font-weight:700; color:#1e293b;">update</span>
                        <button id="sb-cipher-modal-close" style="background:none; border:none; font-size:16px; cursor:pointer; color:#64748b;">✕</button>
                    </div>

                </div>

                <!-- API Modal -->
                <div id="sb-api-modal-slotbd" style="display:none;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px; padding-bottom:12px; border-bottom:1px solid #e2e8f0;">
                        <span style="font-size:14px; font-weight:700; color:#1e293b;">🔗 API Manager</span>
                        <button id="sb-api-modal-close" style="background:none; border:none; font-size:18px; cursor:pointer; color:#64748b;">✕</button>
                    </div>

                    <div class="config-row" style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                        <a id="sb-link-cipher" href="${APIManager.get('cipherServer')}" target="_blank" rel="noopener noreferrer" style="text-decoration:none; font-size:11px; font-weight:700; color:#4338ca;">1Cap Link,</a>
                        <a id="sb-link-dapi" href="${APIManager.get('dapiServer')}" target="_blank" rel="noopener noreferrer" style="text-decoration:none; font-size:11px; font-weight:700; color:#4338ca;">2API link</a>
                        <input type="checkbox" id="sb-enc-check" class="config-chk" style="width:14px; height:14px; cursor:pointer;" ${cipherEnabled ? 'checked' : ''}>
                        <div id="sb-enc-status" style="font-size:11px; font-weight:700; color:${cipherEnabled ? '#14a800' : '#64748b'};">${cipherEnabled ? 'Custom Active' : '⚙️ Hardcode'}</div>
                    </div>


                    <textarea id="sb-enc-script" placeholder="Paste encryptToken(rawToken, purpose) script..." style="width:100%; min-height:100px;  font-family:monospace; font-size:10px; border:1px solid #cbd5e1; border-radius:4px; padding:6px; margin-bottom:2px; box-sizing:border-box; resize:vertical;"></textarea>
                    <div style="display:flex; gap:4px;">
                        <button class="sb-btn sb-white sb-full" id="sb-enc-fetch" style="height:28px; font-size:11px;">🌐 Fetch</button>
                        <button class="sb-btn sb-white sb-full" id="sb-enc-save" style="height:28px; font-size:11px;">💾 Save</button>
                        <button class="sb-btn sb-white sb-full" id="sb-enc-reset" style="height:28px; font-size:11px;">🗑️ Reset</button>
                    </div>
                    <div style="display:flex; gap:8px; margin-bottom:2px;  padding:2px; background:#f0fdf4; border-radius:4px; border:1px solid #86efac;">
                        <button id="sb-api-tab-dynamic" class="api-tab active" style="flex:1;height:28px; padding:4px; background:#22c55e; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600; font-size:12px;">📄 Dynamic Script</button>
                        <button id="sb-api-tab-manual" class="api-tab" style="flex:1; padding:4px; height:28px; background:#e2e8f0; color:#1e293b; border:none; border-radius:4px; cursor:pointer; font-weight:600; font-size:12px;">⚙️ Manual Config</button>
                    </div>

                    <!-- DAPI Row -->
                    <div class="dapi-row">

                        <input class="dapi-input" id="sb-dapi-url"  value="${APIManager.get('dapiServer')}">
                        <button class="dapi-fetch-btn" id="sb-dapi-fetch">Fetch</button>
                        <span id="sb-dapi-status" class="dapi-status" style="display:none;"></span>
                    </div>

                    <div id="sb-api-tab-dynamic-content" class="api-tab-content" style="display:block;">
                        <div style="margin-bottom:12px;">
                        </div>



                        <div id="sb-api-detection-status" style="display:none; padding:10px; background:#fef3c7; border:1px solid #f59e0b; border-radius:4px; margin-bottom:12px; font-size:11px; color:#92400e; line-height:1.5;"></div>

                        <div id="sb-api-detected-container" style="display:none; margin-bottom:12px;">
                            <div style="font-size:11px; font-weight:700; color:#1e293b; margin-bottom:8px;">✅ Detected Endpoints:</div>
                        </div>

                        <div style="display:flex; gap:6px; margin-bottom:12px;">
                            <button id="sb-api-auto-config" style="flex:1; padding:8px; background:#14a800; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600; font-size:11px; display:none;">Auto-Config</button>

                        </div>

                        <div id="sb-api-info" style="padding:10px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:4px; font-size:10px; color:#0369a1; line-height:1.6; max-height:100px; overflow-y:auto;">Ready to load API script...</div>
                    </div>

                    <div id="sb-api-tab-manual-content" class="api-tab-content" style="display:none;">
                        <div id="sb-api-modal-fields"></div>
                    </div>

                    <div style="margin-top:2px; padding-top:12px; border-top:1px solid #e2e8f0;">
                        <div style="display:flex; align-items:center; gap:4px; margin-bottom:7px;">
                            <label id="sb-har-label" style="display:inline-flex; align-items:center; gap:3px; height:24px; padding:0 5px; border:1px solid #0369a1; border-radius:4px; background:#eff6ff; color:#0369a1; font-size:10px; font-weight:600; cursor:pointer; white-space:nowrap; max-width:172px; min-width:172px; overflow:hidden;">
                                📁 HAR File Import
                                <input type="file" id="sb-har-input" accept=".har,application/json" style="display:none;">
                            </label>
                            <div id="sb-har-status" style="font-size:10px; color:#64748b; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></div>
                            <button id="sb-api-modal-save" style="height:24px; padding:0 10px; background:#0369a1; color:#fff; border:none; border-radius:4px; font-size:10px; font-weight:700; cursor:pointer; white-space:nowrap;">💾 Save</button>
                            <button id="sb-api-modal-reset" style="height:24px; padding:0 8px; background:#fff; color:#e11d48; border:1px solid #e11d48; border-radius:4px; font-size:10px; font-weight:700; cursor:pointer; white-space:nowrap;">Reset</button>
                        </div>
                        <div id="sb-har-preview" style="display:none; margin-top:6px; background:#f0fdf4; border:1px solid #86efac; border-radius:4px; padding:7px 9px; font-size:10px; color:#1e293b; line-height:1.9; font-family:monospace; max-height:110px; overflow-y:auto;"></div>
                    </div>
                </div>
                <div id="sb-body">
                    <div id="sb-config-modal-overlay">
                        <div id="sb-config-card">
                            <div id="sb-config-modal-title">
                                <span>⚙️ Settings</span>
                                <button id="sb-config-close-btn">✕</button>
                            </div>
                            <div class="config-row"><label style="color:#14a800; font-weight:700;">Auto Chain Mode</label><input type="checkbox" id="cfg-autochain-toggle" class="config-chk" ${CONFIG.autoChain ? 'checked' : ''}></div>
                            <div class="config-row"><label>Retry Enabled</label><input type="checkbox" id="cfg-retry-toggle" class="config-chk" ${CONFIG.retryEnabled ? 'checked' : ''}></div>
                            <div class="config-row"><label>Retry Delay (sec)</label><input type="number" id="cfg-retry-delay" class="config-inp" value="${CONFIG.retryDelay}"></div>
                            <div class="config-row"><label>Max Retry Attempts</label><input type="number" id="cfg-retry-max" class="config-inp" value="${CONFIG.maxAttempts}"></div>
                            <div class="config-row"><label>Auto Loop Captcha</label><input type="checkbox" id="cfg-captcha-auto" class="config-chk" ${CONFIG.autoCaptcha ? 'checked' : ''}></div>
                            <div class="config-row"><label>Captcha Delay (sec)</label><input type="number" step="0.1" id="cfg-captcha-delay" class="config-inp" value="${CONFIG.captchaDelay || 1.2}"></div>
                            <button id="sb-save-config-btn">Save Config</button>
                        </div>
                    </div>

                    <div id="sb-ts-card">
                        <div id="sb-ts-topbar">

                            <span class="sb-badge" id="sb-ts-badge">${TokenPoolManager.count()}</span>
                            <button class="ts-refbtn" id="sb-ts-refresh">Refresh</button>
                            <button class="ts-colbtn" id="sb-ts-collapse">▲</button>
                            <button id="sb-fetch-all-btn" class="ts-refbtn" style="color:#fff; border-color:#f59e0b; background:#f59e0b; font-weight:600;" title="Fetch Cipher & DAPI + Auto-Save">DAPI</button>
                            <button id="sb-api-modal-btn" class="ts-refbtn" style="color:#fff; border-color:#0369a1;background:#f59e0b;"title="Fetch Cipher & DAPI">API Manager</button>
                            <button id="sb-toggle-config" class="ts-refbtn" style="color:#fff; border-color:#14a800;">⚙️</button>
                        </div>
                        <div id="sb-ts-body"><div id="sb-ts-widget"></div></div>
                    </div>

                     <hr class="sb-sep">
                    <div id="sb-msg">Ready</div>


                    <div style="display:flex; gap:4px; margin-bottom:6px;">
                        <select id="sb-profile-select" style="flex:1; height:30px; padding:0 4px;width: 30px; border-radius:4px; border:1px solid #e2e8f0; font-size:12px; color:#1e293b; background:#f8fafc; outline:none; cursor:pointer;">
                            <option value="">— Select Profile —</option>
                        </select>
                        <button id="sb-profile-settings" title="Add / Manage Profiles" style="width:30px; height:30px; flex-shrink:0; border-radius:4px; border:1px solid #e2e8f0; background:#f8fafc; cursor:pointer; font-size:14px;">👤</button>
                    </div>

                    <div id="sb-auth-card">
                        <div class="sb-grid-row">
                            <input class="sb-inp" id="sb-phone" placeholder="Phone Number" value="${CONFIG.phone}" />
                            <input class="sb-inp" id="sb-pass" type="text" placeholder="Password" value="${CONFIG.password}" />
                            <button class="sb-btn sb-green" id="sb-signin">Signin</button>
                        </div>
                        <div class="sb-grid-row">
                            <input class="sb-inp" id="sb-otp" placeholder="OTP" />
                            <button class="sb-btn sb-white" id="sb-getotp">Get OTP</button>
                            <button class="sb-btn sb-green" id="sb-verify">Verify</button>
                        </div>
                    </div>

                    <div class="form-row btn-row" style="display:flex; margin-bottom:8px; gap:2px;">
    <button id="btn-appointment" class="modern-btn" style="flex:4; background:#14a800; border-color:#c7d2fe; color:#f0f0f0;">Appointment</button>
    <button id="btn-all-up" class="modern-btn" style="flex:4; background:#14a800; border-color:#c7d2fe; color:#f0f0f0;">S All Up</button>
</div>


                    <div class="form-row btn-row" style="align-items:center;gap:4px;">
                        <label for="pdf-upload-patent" style="flex:1;min-width:0;cursor:pointer;">
                            <div id="file-info-patent" class="file-info-bar">📂 Primary File</div>
                            <input type="file" id="pdf-upload-patent" accept="application/pdf" class="modern-input file-input" style="display:none;">
                        </label>
                        <button id="btn-upload-1" class="modern-btn btn-patent" style="flex:0 0 30px;">P</button>
                    </label>
                        <label for="pdf-upload-attend-1" style="flex:1;min-width:0;cursor:pointer;">
                            <div id="file-info-attend-1" class="file-info-bar">📂 S File 1</div>
                            <input type="file" id="pdf-upload-attend-1" accept="application/pdf" class="modern-input file-input" style="display:none;">
                        </label>
                        <button id="btn-attend-1" class="modern-btn btn-attend" style="flex:0 0 30px;">S1</button>
                    </div>

                    <div class="form-row btn-row" style="align-items:center;gap:4px;">
                        <label for="pdf-upload-attend-2" style="flex:1;min-width:0;cursor:pointer;">
                            <div id="file-info-attend-2" class="file-info-bar">📂 S File 2</div>
                            <input type="file" id="pdf-upload-attend-2" accept="application/pdf" class="modern-input file-input" style="display:none;">
                        </label>
                        <button id="btn-attend-2" class="modern-btn btn-attend" style="flex:0 0 30px;">S2</button>

                        </label>

                        <label for="pdf-upload-attend-3" style="flex:1;min-width:0;cursor:pointer;">
                            <div id="file-info-attend-3" class="file-info-bar">📂 S File 3</div>
                            <input type="file" id="pdf-upload-attend-3" accept="application/pdf" class="modern-input file-input" style="display:none;">
                        </label>
                        <button id="btn-attend-3" class="modern-btn btn-attend" style="flex:0 0 30px;">S3</button>
                    </div>

                    <div class="section-label" style="margin-top:6px; display:none;">🔁 Re-upload / Replace File</div>
                    <div id="delete-dropdown-wrapper" style="margin-bottom:6px; display:none;">
                        <select id="delete-file-select" class="modern-input" style="cursor:pointer;height:auto;border-color:#fca5a5;display:none;">
                            <option  value="">Select File (Delete / Re-upload)</option>
                        </select>
                    </div>
                    <div class="form-row btn-row" style="align-items:center;gap:4px;">
                        <label for="pdf-upload-reupload" style="flex:1;min-width:0;cursor:pointer;">
                            <div id="file-info-reupload" style="display:none;" class="file-info-bar">📂 New PDF File</div>
                            <input type="file" id="pdf-upload-reupload" accept="application/pdf" class="modern-input file-input" style="display:none;">
                        </label>
                        <button id="btn-reupload" class="modern-btn btn-reupload" style="flex:0 0 65px;min-width:85px; display:none;">Re-up</button>

                    </div>

                    <div class="nav-divider"></div>
                    <div class="action-row">
                    <button id="btn-overview" class="action-btn btn-overview-green">Overview</button>
                        <div id="hc-dropdown-wrapper" style="flex:1.4; min-width:0;">

                            <select id="hc-city-select" class="modern-input" style="cursor:pointer;height:32px;width:100%;font-size:10px;">
                                <option value="">Select Mission</option>
                            </select>

                        </div>

                        <button id="btn-booking-config" class="action-btn btn-booking sb-green sb-full">Confirm</button>


                    </div>
        <div id="center-dropdown-wrapper" style="display:none; margin-top:8px;">
                        <select id="ivac-center-select" class="modern-input" style="cursor:pointer;height:auto;width:100%;">
                            <option value="">Select Center</option>
                        </select>
                    </div>
                   <div style="display:flex; gap:4px; margin-bottom:4px;">
                    <select id="sb-date-select" style="display:flex; width:100%; margin-bottom:4px; padding:6px 8px; border-radius:4px; border:1px solid #e2e8f0; font-size:12px; color:#1e293b; background:#f8fafc; box-sizing:border-box;"></select>

                        <input class="sb-inp" id="sb-appt-id" placeholder="Appointment ID" style="font-size:11px;height:30px;display:flex font-family:monospace;" value="${AuthManager.getAppointmentId()}" />
                        <button class="sb-btn sb-white" id="sb-copy-appt" style="width:60px; height:30px; font-size:11px; display:none">Copy</button>
                        <button class="sb-btn sb-green" id="sb-save-appt" style="width:60px; height:30px; font-size:11px;display:none">Save</button>
                   </div>
                   <div id="sb-actions">
                        <button class="sb-btn sb-green sb-full" id="sb-getbooking">Get booking</button>
                        <button class="sb-btn sb-green sb-full" id="sb-reserve">ReserveSlot</button>
                        <button class="sb-btn sb-green sb-full" id="sb-dgpay">Initiate</button>
                    </div>
                    <div style="margin-top:5px;">
                        <button class="sb-btn" id="sb-stop-all" style="height:32px; background:red; color:#fff; border-color:#e11d48; font-weight:700;">Stop All</button>
                    </div>
                    <div id="sb-paybox">
                        <div class="pay-row">
                            <span class="pay-ttl">Link</span>
                            <div class="pay-url" id="sb-payurl" title=""></div>
                            <button class="pay-open" id="sb-open">Open</button>
                            <button class="pay-copy" id="sb-copy">Copy</button>
                        </div>
                    </div>
                </div>
            `;
// প্যানেল থেকে All Up বাটনটি খুঁজে বের করা হচ্ছে
    const allUpBtn = panel.querySelector('#btn-all-up');

    if (allUpBtn) {
        allUpBtn.addEventListener('click', function(e) {
            e.preventDefault();

            // প্যানেলের ভেতর যতগুলো '.btn-attend' ক্লাস যুক্ত বাটন (S1, S2, S3) আছে,
            // সবগুলোতে লুপ চালিয়ে ক্লিক করানো হচ্ছে।
            const attendButtons = panel.querySelectorAll('.btn-attend');
            attendButtons.forEach(btn => {
                btn.click();
            });

            console.log('S1, S2, S3 বাটনে একসাথে ক্লিক করা হয়েছে!');
        });
    }

            mountEl.appendChild(panel);



                        // ─── API Modal: drag support ───────────────────────────────
            (function enableApiModalDrag() {
                const modal = document.getElementById('sb-api-modal-slotbd');
                if (!modal) return;
                const handle = modal.firstElementChild; // "🔗 API Manager" হেডার

                // shell-এর drag যেন modal-এর ভেতরে না চলে
                modal.addEventListener('mousedown', (e) => e.stopPropagation());

                handle.style.cursor = 'move';
                handle.style.userSelect = 'none';
                handle.style.touchAction = 'none';

                let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;

                handle.addEventListener('pointerdown', (e) => {
                    if (e.target.closest('button, input, select, textarea')) return;
                    const r = modal.getBoundingClientRect();
                    // center-transform বাদ দিয়ে px position-এ রূপান্তর
                    modal.style.transform = 'none';
                    modal.style.left = r.left + 'px';
                    modal.style.top = r.top + 'px';
                    dragging = true;
                    sx = e.clientX; sy = e.clientY;
                    sl = r.left; st = r.top;
                    handle.setPointerCapture(e.pointerId);
                    e.preventDefault();
                });

                handle.addEventListener('pointermove', (e) => {
                    if (!dragging) return;
                    const r = modal.getBoundingClientRect();
                    let nl = sl + (e.clientX - sx);
                    let nt = st + (e.clientY - sy);
                    nl = Math.max(0, Math.min(nl, window.innerWidth - r.width));
                    nt = Math.max(0, Math.min(nt, window.innerHeight - 40));
                    modal.style.left = nl + 'px';
                    modal.style.top = nt + 'px';
                });

                const stop = (e) => {
                    if (!dragging) return;
                    dragging = false;
                    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
                };
                handle.addEventListener('pointerup', stop);
                handle.addEventListener('pointercancel', stop);
            })();



                        // ─── Settings modal: drag support ──────────────────────────
            (function enableConfigModalDrag() {
                const overlay = document.getElementById('sb-config-modal-overlay');
                const card = document.getElementById('sb-config-card');
                const handle = document.getElementById('sb-config-modal-title');
                if (!overlay || !card || !handle) return;

                handle.style.cursor = 'move';
                handle.style.userSelect = 'none';
                handle.style.touchAction = 'none';

                // shell-এর drag যেন না চলে
                overlay.addEventListener('mousedown', (e) => e.stopPropagation());

                let dragging = false, moved = false;
                let sx = 0, sy = 0, ox = 0, oy = 0; // ox/oy = জমা হওয়া offset

                handle.addEventListener('pointerdown', (e) => {
                    if (e.target.closest('button, input, select, textarea')) return;
                    dragging = true;
                    moved = false;
                    sx = e.clientX - ox;
                    sy = e.clientY - oy;
                    handle.setPointerCapture(e.pointerId);
                    e.preventDefault();
                });

                handle.addEventListener('pointermove', (e) => {
                    if (!dragging) return;
                    moved = true;
                    let nx = e.clientX - sx;
                    let ny = e.clientY - sy;
                    card.style.transform = `translate(${nx}px, ${ny}px)`;

                    // স্ক্রিনের বাইরে গেলে ভেতরে ফিরিয়ে আনো
                    const r = card.getBoundingClientRect();
                    if (r.left < 0) nx -= r.left;
                    if (r.right > window.innerWidth) nx -= (r.right - window.innerWidth);
                    if (r.top < 0) ny -= r.top;
                    if (r.bottom > window.innerHeight) ny -= (r.bottom - window.innerHeight);
                    card.style.transform = `translate(${nx}px, ${ny}px)`;
                    ox = nx; oy = ny;
                });

                const stop = (e) => {
                    if (!dragging) return;
                    dragging = false;
                    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
                };
                handle.addEventListener('pointerup', stop);
                handle.addEventListener('pointercancel', stop);

                // drag শেষে mouse overlay-তে ছাড়লে modal যেন বন্ধ না হয়
                overlay.addEventListener('click', (e) => {
                    if (moved) {
                        e.stopImmediatePropagation();
                        moved = false;
                    }
                }, true);

                // ⚙️ বাটনে আবার খুললে মাঝখানে ফিরে আসবে
                document.getElementById('sb-toggle-config')?.addEventListener('click', () => {
                    ox = 0; oy = 0;
                    card.style.transform = '';
                });
            })();



            // ─── DAPI FETCH EVENT - FIXED ──────────────────────────────────────

            document.getElementById('sb-dapi-fetch').addEventListener('click', async () => {
                const urlInput = document.getElementById('sb-dapi-url');
                const statusEl = document.getElementById('sb-dapi-status');
                const url = urlInput?.value.trim();

                statusEl.textContent = '⏳';
                statusEl.className = 'dapi-status loading';

                try {
                    const manager = initEnhancedDynamicApiManager();

                    // Fetch and load the API
                    await manager.userLoadApi(url, false);

                    // Get detected endpoints
                    const endpoints = manager.getDetectedEndpoints();
                    const validation = manager.getValidationStatus(); // ✅ Now works!
                    const headers = manager._headerCache || {};
                    const payloads = manager._payloadCache || {};
                    const constants = manager.getConstants();

                    // Show detected endpoints
                    const container = document.getElementById('sb-api-detected-list');
                    if (container) {
                        if (Object.keys(endpoints).length === 0) {
                            container.innerHTML = '<div style="color:#94a3b8;font-size:11px;padding:8px;text-align:center;">No endpoints detected</div>';
                        } else {
                            container.innerHTML = Object.entries(endpoints)
                                .map(([key, value]) => {
                                    const fnName = typeof value === 'object' ? value.name || value : value;
                                    const headerInfo = headers[fnName] || [];
                                    const payloadInfo = payloads[fnName] || [];
                                    return `
                                        <div style="padding:6px 8px; background:#fff; border:1px solid #86efac; border-radius:4px; font-size:10px; margin-bottom:4px;">
                                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                                <strong style="color:#22c55e;">${key}</strong>
                                                <span style="color:#64748b; font-family:monospace; font-size:9px;">${fnName}</span>
                                            </div>
                                            ${headerInfo.length > 0 ? `<div style="font-size:8px; color:#4338ca; margin-top:2px;">📌 Headers: ${headerInfo.join(', ')}</div>` : ''}
                                            ${payloadInfo.length > 0 ? `<div style="font-size:8px; color:#be185d; margin-top:2px;">📦 Payload: ${payloadInfo.join(', ')}</div>` : ''}
                                        </div>
                                    `;
                                })
                                .join('');
                        }
                        document.getElementById('sb-api-detected-container').style.display = 'block';
                    }

                    // Show auto-configure button
                    const autoBtn = document.getElementById('sb-api-auto-config');
                    if (autoBtn) {
                        autoBtn.style.display = validation.isValid ? 'block' : 'none';
                    }

                    // Update status
                    const detectStatus = document.getElementById('sb-api-detection-status');
                    if (detectStatus) {
                        if (validation.isValid) {
                            detectStatus.textContent = `✅ Fetched & loaded ${Object.keys(endpoints).length} endpoints from DAPI!`;
                            detectStatus.style.background = '#dcfce7';
                            detectStatus.style.color = '#166534';
                        } else {
                            detectStatus.textContent = `⚠️ Fetched but missing: ${validation.missing.join(', ')}`;
                            detectStatus.style.background = '#fef3c7';
                            detectStatus.style.color = '#92400e';
                        }
                        detectStatus.style.display = 'block';
                    }

                    // Update info
                    const infoEl = document.getElementById('sb-api-info');
                    if (infoEl) {
                        infoEl.textContent = `✅ Remote API loaded from ${url} | SLOT_ID: ${constants.SLOT_ID || 'N/A'} | DGEPAY_ID: ${constants.DGEPAY_ID || 'N/A'}`;
                    }

                    // Status success
                    statusEl.textContent = `✅ ${Object.keys(endpoints).length}`;
                    statusEl.className = 'dapi-status ok';

                    // Save DAPI URL
                    APIManager.set('dapiServer', url);
                    window._ivacAPIS = APIManager.getAll();

                    buildApiFields();


                    log(`✅ Fetched ${Object.keys(endpoints).length} endpoints from DAPI server`, 'ok');

                } catch (error) {
                    statusEl.textContent = '❌ Error';
                    statusEl.className = 'dapi-status error';

                    const detectStatus = document.getElementById('sb-api-detection-status');
                    if (detectStatus) {
                        detectStatus.textContent = `❌ Fetch error: ${error.message}`;
                        detectStatus.style.display = 'block';
                        detectStatus.style.background = '#fee2e2';
                        detectStatus.style.color = '#991b1b';
                    }

                    log(`❌ DAPI fetch error: ${error.message}`, 'err');
                }
            });

            // ─── EVENTS ──────────────────────────────────────────────────

            document.getElementById('sb-signin').addEventListener('click', doSignin);
            document.getElementById('sb-getotp').addEventListener('click', doGetOtp);
            document.getElementById('sb-verify').addEventListener('click', doVerify);

           // Existing code রাখা (modify নয়)
const sbOtpInput = document.getElementById('sb-otp');
if (sbOtpInput) {
    let autoVerifyTimer = null;

    sbOtpInput.addEventListener('input', function() {
        const val = this.value;
        const converted = sbExtractOtp(val);
        if (converted && converted !== val) {
            this.value = converted;
        }

        // ✅ Auto-Verify Logic - সরাসরি doVerify() কল করুন
        const otp = this.value.trim();
        if (/^\d{6}$/.test(otp)) {
            console.log('[AUTO-VERIFY] ✅ 6-digit OTP detected:', otp);

            if (autoVerifyTimer) clearTimeout(autoVerifyTimer);

          // ✅ নতুন:
autoVerifyTimer = setTimeout(async () => {
    if (doVerifyInProgress) {  // ← চেক করুন
        console.log('[AUTO-VERIFY] ⚠️ doVerify already in progress, skipping...');
        return;
    }

    try {
        doVerifyInProgress = true;  // ← flag set করুন
        console.log('[AUTO-VERIFY] 🔥 Calling doVerify()...');
        await doVerify();
        console.log('[AUTO-VERIFY] ✅ doVerify() completed');
    } catch (err) {
        console.error('[AUTO-VERIFY] ❌ Error:', err);
    } finally {
        doVerifyInProgress = false;  // ← flag reset করুন
    }
}, 100);
        }
    });

    sbOtpInput.addEventListener('paste', function(e) {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text');
        const converted = sbExtractOtp(pasted) || pasted;
        this.value = converted;
        this.dispatchEvent(new Event('input', { bubbles: true }));
    });

    console.log('[AUTO-VERIFY] ✅ Listener attached');
}

            document.getElementById('sb-reserve').addEventListener('click', doReserve);
            document.getElementById('sb-getbooking').addEventListener('click', doGetBooking);
            document.getElementById('sb-dgpay').addEventListener('click', doDGPay);

            document.getElementById('sb-stop-all').addEventListener('click', () => {
                stopAllFlag = true;
                currentClickId++;
                if (otpPollerTimer) {
                    clearInterval(otpPollerTimer);
                    otpPollerTimer = null;
                    setOtpBtn('idle');
                }
                log('All requests and Auto-Chain STOPPED.', 'err');
                log('All Processes Stopped.');
            });

            document.getElementById('sb-toggle-config').addEventListener('click', () => {
                document.getElementById('sb-config-modal-overlay').classList.toggle('open');
            });

            document.getElementById('sb-config-close-btn').addEventListener('click', () => {
                document.getElementById('sb-config-modal-overlay').classList.remove('open');
            });

            document.getElementById('sb-config-modal-overlay').addEventListener('click', (e) => {
                if (e.target === document.getElementById('sb-config-modal-overlay')) {
                    document.getElementById('sb-config-modal-overlay').classList.remove('open');
                }
            });

            document.getElementById('sb-ts-refresh').addEventListener('click', () => {
                log('Turnstile refreshing...', 'info');
                renderTurnstile();
            });

            document.getElementById('sb-ts-collapse').addEventListener('click', () => {
                const body = document.getElementById('sb-ts-body');
                const btn = document.getElementById('sb-ts-collapse');
                tsCollapsed = !tsCollapsed;
                body.style.display = tsCollapsed ? 'none' : 'flex';
                btn.textContent = tsCollapsed ? '▼' : '▲';
            });

            document.getElementById('sb-copy').addEventListener('click', () => {
                if (pendingPayUrl) ClipboardManager.copy(pendingPayUrl);
                const btn = document.getElementById('sb-copy');
                btn.textContent = 'Copied!';
                log('Payment link copied.', 'ok');
                setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
            });

            document.getElementById('sb-open').addEventListener('click', () => {
                if (pendingPayUrl) window.open(pendingPayUrl, '_blank');
                log('Opening payment link...', 'ok');
            });

            document.getElementById('sb-copy-appt').addEventListener('click', () => {
                const val = document.getElementById('sb-appt-id')?.value;
                if (val) ClipboardManager.copy(val);
                const btn = document.getElementById('sb-copy-appt');
                btn.textContent = 'Copied!';
                log('Appointment ID copied.', 'ok');
                setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
            });

            document.getElementById('sb-save-appt').addEventListener('click', () => {
                const val = document.getElementById('sb-appt-id')?.value.trim();
                if (!val) {
                    log('Enter Appointment ID.', 'warn');
                    return;
                }
                AuthManager.setAppointmentId(val);
                log(`Appointment ID saved: ${val}`, 'ok');
                log(`Appointment ID saved.`);
            });


            document.getElementById('sb-date-select').addEventListener('change', function() {
                window.__IVAC.auth.selectedDate = this.value;
                log(`Date selected: ${this.value}`, 'info');
            });

            // ─── Config save ──────────────────────────────────────────
            document.getElementById('sb-save-config-btn').addEventListener('click', () => {
                CONFIG.autoChain = document.getElementById('cfg-autochain-toggle').checked;
                CONFIG.retryEnabled = document.getElementById('cfg-retry-toggle').checked;
                CONFIG.retryDelay = parseFloat(document.getElementById('cfg-retry-delay').value) || 20;
                CONFIG.maxAttempts = parseInt(document.getElementById('cfg-retry-max').value) || 103;
                CONFIG.autoCaptcha = document.getElementById('cfg-captcha-auto').checked;
                CONFIG.captchaDelay = parseFloat(document.getElementById('cfg-captcha-delay').value) || 1.2;
                CONFIG.phone = document.getElementById('sb-phone').value.trim();
                CONFIG.password = document.getElementById('sb-pass').value.trim();
                SharedProfile.set(CONFIG.phone, CONFIG.password);
                saveUIConfig();
                log('Settings saved!', 'ok');
                log('Configuration saved.');
                renderTurnstile();
                document.getElementById('sb-config-modal-overlay')?.classList.remove('open');
            });



            document.getElementById('sb-cipher-modal-close').addEventListener('click', () => {
                document.getElementById('sb-cipher-modal').style.display = 'none';
            });

       document.getElementById('sb-enc-fetch').addEventListener('click', () => {
    const url = apiUrl('cipherServer');
    console.log('[CIPHER FETCH] Fetching from:', url);

    GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        headers: {
            'ngrok-skip-browser-warning': 'true',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'application/json, text/plain, */*'
        },
        timeout: 10000,
        onload: (res) => {
            console.log('[CIPHER FETCH] Response status:', res.status);

            if (res.status >= 200 && res.status < 300 && res.responseText) {
                console.log('[CIPHER FETCH] ✅ Loaded, script length:', res.responseText.length);

                // ✅ Textarea-তে populate করো
                const ta = document.getElementById('sb-enc-script');
                if (ta) {
                    ta.value = res.responseText;
                    console.log('[CIPHER FETCH] ✅ Textarea populated');
                }

                // Auto-load cipher function
                try {
                    const fn = new Function('rawToken', 'purpose', `
                        "use strict";
                        ${res.responseText}
                        if (typeof encryptToken === 'function') return encryptToken(rawToken, purpose);
                        if (typeof ProcessToken === 'function') return ProcessToken(rawToken, purpose);
                        if (typeof encryptCaptchaToken === 'function') return encryptCaptchaToken(rawToken, purpose);
                        return rawToken;
                    `);
                   // fn('', '');
                    CipherManager._unifiedFn = fn;
                    CipherManager._enabled = true;

                    // ✅ UI update করো
                    document.getElementById('sb-enc-check').checked = true;
                    document.getElementById('sb-enc-status').textContent = '✅ Custom Active';
                    document.getElementById('sb-enc-status').style.color = '#14a800';

                    log('✅ Cipher fetched, loaded & activated!', 'ok');
                } catch (e) {
                    console.error('[CIPHER] Function creation error:', e);
                    log('❌ Cipher script invalid', 'err');
                }
            } else {
                console.log('[CIPHER FETCH] ❌ Bad response:', res.status);
                log('❌ Cipher server error', 'err');
            }
        },
        onerror: () => {
            console.error('[CIPHER FETCH] ❌ Request error');
            log('❌ Failed to fetch cipher', 'err');
        },
        ontimeout: () => {
            console.error('[CIPHER FETCH] ❌ Timeout');
            log('❌ Cipher fetch timed out', 'err');
        }
    });
});
      document.getElementById('sb-enc-save').addEventListener('click', () => {
    const ta = document.getElementById('sb-enc-script');
    if (!ta?.value.trim()) {
        log('Paste script first!', 'warn');
        return;
    }

    const scriptContent = ta.value.trim();
    console.log('[CIPHER SAVE] Script length:', scriptContent.length);
    console.log('[CIPHER SAVE] Checking for required functions...');

    try {
        // Check if script has required functions
        const hasEncryptToken = scriptContent.includes('function encryptToken') &&
                               scriptContent.includes('purpose');
        const hasProcessToken = scriptContent.includes('function ProcessToken');

        console.log('[CIPHER SAVE] Has encryptToken:', hasEncryptToken);
        console.log('[CIPHER SAVE] Has ProcessToken:', hasProcessToken);

        if (!hasEncryptToken && !hasProcessToken) {
            throw new Error('Script missing encryptToken or ProcessToken function');
        }

        // Step 1: Save to localStorage
        console.log('[CIPHER SAVE] Saving to localStorage...');
        localStorage.setItem('slotbd_enc_unified_script', scriptContent);
        localStorage.setItem('slotbd_enc_unified_check', '1');
        console.log('[CIPHER SAVE] ✅ LocalStorage saved');

        // Step 2: Don't test function directly - just validate syntax
        console.log('[CIPHER SAVE] Validating script syntax...');
        try {
            // এভাবে validate করো - শুধু wrapping test করো, function call না করে
            new Function(`"use strict"; ${scriptContent}`);
            console.log('[CIPHER SAVE] ✅ Syntax validation passed');
        } catch (syntaxError) {
            throw new Error(`Script syntax error: ${syntaxError.message}`);
        }

        // Step 3: Load cipher from storage
        console.log('[CIPHER SAVE] Loading cipher from storage...');
        const ok = loadCipherFromStorage();
        console.log('[CIPHER SAVE] loadCipherFromStorage result:', ok);

        if (!ok) {
            throw new Error('Failed to load cipher from localStorage');
        }

        // Step 4: Activate cipher
        cipherEnabled = true;
        console.log('[CIPHER SAVE] ✅ Cipher activated');

        // Step 5: Update UI
        const checkEl = document.getElementById('sb-enc-check');
        const statusEl = document.getElementById('sb-enc-status');

        if (checkEl) {
            checkEl.checked = true;
            console.log('[CIPHER SAVE] ✅ UI checkbox updated');
        }

        if (statusEl) {
            statusEl.textContent = '✅ Custom Active';
            statusEl.style.color = '#14a800';
            console.log('[CIPHER SAVE] ✅ UI status updated');
        }

        console.log('[CIPHER SAVE] ✅ SUCCESS - Cipher saved & active');
        log('✅ Cipher saved & active', 'ok');
        AudioManager.playBeep();

        // Close modal
        setTimeout(() => {
            document.getElementById('sb-cipher-modal').style.display = 'none';
        }, 300);

    } catch (e) {
        console.error('[CIPHER SAVE] ❌ ERROR:', e.message);

        log(`❌ ${e.message}`, 'err');

        // Reset
        cipherEnabled = false;
        cipherFn = null;

        const checkEl = document.getElementById('sb-enc-check');
        const statusEl = document.getElementById('sb-enc-status');
        if (checkEl) checkEl.checked = false;
        if (statusEl) {
            statusEl.textContent = '⚙️ Hardcode';
            statusEl.style.color = '#64748b';
        }
    }
});

            // ─── API Modal events ─────────────────────────────────────
             function buildApiFields() {
                const container = document.getElementById('sb-api-modal-fields');
                if (!container) return;

                const apis = APIManager.getAll();
                const labels = APIManager.getLabels();

                // 🚫 লাল দাগ দেওয়া ফিল্ডগুলো হাইড করার তালিকা:
                const hiddenKeys = [
                    'baseApi',
                    'getBooking',        // Get Booking
                    'otpPoller1',       // OTP Poller 1
                    'otpPoller2',       // OTP Poller 2
                    'otpPoller',        // Old OTP Poller
                    'invoice',          // Invoice
                    'appointment',      // Appointment
                    'bookingConfig',    // Booking Conf
                    'highCommissions',  // High Comm
                    'ivacCenters',      // IVAC Centers
                    'deleteFile'        // Delete File
                ];

                // ✂️ ডোমেইন ছাড়া শুধু v1/... অংশটুকু রাখার ফাংশন
                function formatShortPath(key, val) {
                    if (!val) return '';
                    // সাইফার বা ড্যাপি সার্ভার লিংক হলে পুরো লিংকই রাখবে
                    if (['cipherServer', 'dapiServer'].includes(key)) return val;
                    // ডোমেইন কেটে শুধু v1/... বা v2/... অংশটুকু বের করবে
                    const match = val.match(/(v\d+\/.*)/);
                    if (match) return match[1];
                    return val.replace(/^https?:\/\/[^\/]+\/(iams\/api\/)?/, '');
                }

                // ✅ শুধুমাত্র প্রয়োজনীয় ফিল্ডগুলো শর্ট পাথ আকারে রেন্ডার হবে
                container.innerHTML = Object.entries(apis)
                    .filter(([k]) => !hiddenKeys.includes(k))
                    .map(([k, v]) => {
                    const shortVal = formatShortPath(k, v);
                    const defaultVal = formatShortPath(k, IVAC_API_DEFAULTS[k] || '');
                    const isChanged = shortVal !== defaultVal;

                    return `
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                            <span id="sb-api-label-${k}"
                                style="font-size:10px;font-weight:700;white-space:nowrap;width:80px;flex-shrink:0;text-align:left;border:1px solid ${isChanged ? '#f59e0b' : '#bfdbfe'};border-radius:4px;padding:4px 4px;background:${isChanged ? '#fef3c7' : '#eff6fe'};color:${isChanged ? '#d97706' : '#0369a1'};box-sizing:border-box;transition:all 0.3s ease;cursor:default;">
                                ${labels[k] || k}
                            </span>
                            <input id="sb-api-f-${k}"
                                value="${shortVal}"
                                data-default="${defaultVal}"
                                style="flex:1;height:26px;padding:0 8px;font-size:10px;font-family:monospace;border:1px solid ${isChanged ? '#f59e0b' : '#e2e8f0'};border-radius:4px;outline:none;box-sizing:border-box;color:#1e293b;background:${isChanged ? '#fffbeb' : '#f8fafc'};transition:all 0.3s ease;"/>
                        </div>`;
                }).join('');

                // ইভেন্ট লিসেনার সেট করা
                Object.keys(apis)
                    .filter(k => !hiddenKeys.includes(k))
                    .forEach((k) => {
                    const input = document.getElementById(`sb-api-f-${k}`);
                    if (input) {
                        input.addEventListener('input', function() {
                            const label = document.getElementById(`sb-api-label-${k}`);
                            const defaultVal = this.getAttribute('data-default') || '';
                            const isChanged = this.value.trim() !== defaultVal;
                            if (label) {
                                label.style.borderColor = isChanged ? '#f59e0b' : '#bfdbfe';
                                label.style.background = isChanged ? '#fef3c7' : '#eff6fe';
                                label.style.color = isChanged ? '#d97706' : '#0369a1';
                            }
                            this.style.borderColor = isChanged ? '#f59e0b' : '#e2e8f0';
                            this.style.background = isChanged ? '#fffbeb' : '#f8fafc';
                        });
                    }
                });
            }
           // ─── MODAL OPEN - ALWAYS FORCE MANUAL CONFIG ACTIVE ───────
            document.getElementById('sb-api-modal-btn').addEventListener('click', () => {
                const modal = document.getElementById('sb-api-modal-slotbd');
                const cipherMod = document.getElementById('sb-cipher-modal');
                if (cipherMod) cipherMod.style.display = 'none';

                if (modal.style.display === 'none' || modal.style.display === '') {
                    // ১. লিঙ্ক দুটি রিফ্রেশ
                    const linkCipher = document.getElementById('sb-link-cipher');
                    const linkDapi = document.getElementById('sb-link-dapi');
                    if (linkCipher) linkCipher.href = APIManager.get('cipherServer') || '#';
                    if (linkDapi) linkDapi.href = APIManager.get('dapiServer') || '#';

                    // ২. ⚡ ১০০% নিশ্চিতভাবে Manual Config সবুজ ও একটিভ করা
                    const tabManual = document.getElementById('sb-api-tab-manual');
                    const tabDynamic = document.getElementById('sb-api-tab-dynamic');
                    const contentManual = document.getElementById('sb-api-tab-manual-content');
                    const contentDynamic = document.getElementById('sb-api-tab-dynamic-content');

                    if (tabManual && tabDynamic) {
                        tabManual.style.setProperty('background', '#22c55e', 'important');
                        tabManual.style.setProperty('color', '#ffffff', 'important');
                        tabManual.classList.add('active');

                        tabDynamic.style.setProperty('background', '#e2e8f0', 'important');
                        tabDynamic.style.setProperty('color', '#1e293b', 'important');
                        tabDynamic.classList.remove('active');
                    }

                    if (contentManual && contentDynamic) {
                        contentManual.style.setProperty('display', 'block', 'important');
                        contentManual.classList.add('active');

                        contentDynamic.style.setProperty('display', 'none', 'important');
                        contentDynamic.classList.remove('active');
                    }

                    // ৩. ইনপুট ফিল্ডগুলো রেন্ডার করা
                    buildApiFields();

                    // ৪. মডাল ওপেন
                    modal.style.display = 'block';
                } else {
                    modal.style.display = 'none';
                }
            });

            // ⚡ FETCH ALL & SAVE BUTTON
            document.getElementById('sb-fetch-all-btn').addEventListener('click', async () => {
                const btn = document.getElementById('sb-fetch-all-btn');
                const originalText = btn.textContent;
                btn.disabled = true;
                btn.style.opacity = '0.6';
                log('⏳ Starting Fetch All...');

                try {
                    // Step 1: Fetch Cipher
                    console.log('[FETCH ALL] Step 1: Fetching Cipher...');
                    log('⏳ Fetching Cipher...');
                    const encFetchBtn = document.getElementById('sb-enc-fetch');
                    encFetchBtn.click();

                    // Wait for cipher to complete
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    // Step 2: Auto-save cipher
                    console.log('[FETCH ALL] Step 2: Saving Cipher...');
                    log('⏳ Saving Cipher...');
                    const encSaveBtn = document.getElementById('sb-enc-save');
                    encSaveBtn.click();

                    // Wait for save to complete
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Step 3: Fetch DAPI
                    console.log('[FETCH ALL] Step 3: Fetching DAPI...');
                    log('⏳ Fetching DAPI...');
                    const dapiFetchBtn = document.getElementById('sb-dapi-fetch');
                    dapiFetchBtn.click();

                    // Wait for DAPI to complete
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    // Step 4: Auto-configure DAPI
                    console.log('[FETCH ALL] Step 4: Auto-configuring DAPI...');
                    log('⏳ Auto-configuring DAPI...');
                    const autoConfigBtn = document.getElementById('sb-api-auto-config');
                    if (autoConfigBtn && autoConfigBtn.style.display !== 'none') {
                        autoConfigBtn.click();
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                    console.log('[FETCH ALL] ✅ All complete!');
                    log('✅ Cipher & DAPI Fetched + Saved!', 'ok');

                } catch (e) {
                    console.error('[FETCH ALL] Error:', e);
                    log('❌ Fetch All failed: ' + e.message, 'err');
                } finally {
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.textContent = originalText;
                }
            });






            document.getElementById('sb-api-modal-close').addEventListener('click', () => {
                document.getElementById('sb-api-modal-slotbd').style.display = 'none';
            });

            document.getElementById('sb-api-modal-save').addEventListener('click', () => {
                const fields = document.querySelectorAll('#sb-api-modal-fields input');
                let savedCount = 0;
                fields.forEach(input => {
                    const key = input.id.replace('sb-api-f-', '');
                    if (input.value.trim()) {
                        APIManager.set(key, input.value.trim());
                        savedCount++;
                    }
                });
                window._ivacAPIS = APIManager.getAll();
                document.getElementById('sb-api-modal-slotbd').style.display = 'none';
                log(`✅ ${savedCount} API endpoints saved!`, 'ok');
            });

           document.getElementById('sb-api-modal-reset').addEventListener('click', () => {
    APIManager.reset();
    // ✅ Fix: Dynamic API manager-ও reset করো
    if (enhancedDynamicApiManager) {
        enhancedDynamicApiManager.isLoaded = false;
        enhancedDynamicApiManager.api = null;
        enhancedDynamicApiManager._endpointCache = {};
        enhancedDynamicApiManager.userLoaded = false;
        localStorage.removeItem('ivac_dynamic_api_full'); // saved cache clear
    }
    window._ivacAPIS = APIManager.getAll();
    buildApiFields();
    log('API reset to default.', 'info');
});

            // ─── API Tab switching ─────────────────────────────────────
            document.getElementById('sb-api-tab-dynamic').addEventListener('click', function() {
                document.querySelectorAll('.api-tab').forEach(t => {
                    t.style.background = t === this ? '#22c55e' : '#e2e8f0';
                    t.style.color = t === this ? '#fff' : '#1e293b';
                });
                document.querySelectorAll('.api-tab-content').forEach(c => {
                    c.style.display = 'none';
                });
                document.getElementById('sb-api-tab-dynamic-content').style.display = 'block';
            });

            document.getElementById('sb-api-tab-manual').addEventListener('click', function() {
                document.querySelectorAll('.api-tab').forEach(t => {
                    t.style.background = t === this ? '#22c55e' : '#e2e8f0';
                    t.style.color = t === this ? '#fff' : '#1e293b';
                });
                document.querySelectorAll('.api-tab-content').forEach(c => {
                    c.style.display = 'none';
                });
                document.getElementById('sb-api-tab-manual-content').style.display = 'block';
                buildApiFields();
            });


            // ─── Auto-Configure ────────────────────────────────────────
            document.getElementById('sb-api-auto-config').addEventListener('click', () => {
                const manager = initDynamicApiManager();
                const config = manager.autoConfigure();

                let configured = 0;
                Object.entries(config).forEach(([key, value]) => {
                    if (typeof value === 'string' && value.length > 0) {
                        const input = document.getElementById(`sb-api-f-${key}`);
                        if (input) {
                            input.value = value;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.style.background = '#f0fdf4';
                            input.style.borderColor = '#86efac';
                            setTimeout(() => {
                                input.style.background = '';
                                input.style.borderColor = '';
                            }, 2000);
                            configured++;
                        }
                    }
                });

                const statusEl = document.getElementById('sb-api-detection-status');
                if (statusEl) {
                    statusEl.textContent = `✅ Auto-configured ${configured} endpoints!`;
                    statusEl.style.background = '#dcfce7';
                    statusEl.style.color = '#166534';
                    statusEl.style.display = 'block';
                }

                Object.entries(config).forEach(([key, value]) => {
                    if (typeof value === 'string' && !['slotId', 'dgepayId'].includes(key)) {
                        APIManager.set(key, value);
                    }
                });

                window._ivacAPIS = APIManager.getAll();
                log(`✅ Auto-configured ${configured} APIs from dynamic script!`, 'ok');
            });




            // ─── HAR Import ─────────────────────────────────────────────
            document.getElementById('sb-har-input').addEventListener('change', function() {
                const file = this.files[0];
                if (!file) return;
                const status = document.getElementById('sb-har-status');
                const preview = document.getElementById('sb-har-preview');

                const reader = new FileReader();
                reader.onload = function(e) {
                    try {
                        const har = JSON.parse(e.target.result);
                        const entries = har?.log?.entries || [];

                        if (!entries.length) {
                            status.textContent = '❌ No entries found in HAR';
                            status.style.color = '#e11d48';
                            return;
                        }

                        const apiEntries = entries.filter(entry => {
                            const url = entry.request?.url || '';
                            return url.includes('api.ivacbd.com');
                        });

                        if (!apiEntries.length) {
                            status.textContent = '⚠️ No api.ivacbd.com requests found';
                            status.style.color = '#d97706';
                            return;
                        }

                        const urls = {};
                        apiEntries.forEach(entry => {
                            const url = entry.request?.url || '';
                            const parsed = new URL(url);
                            const path = parsed.pathname;

                            const mappings = {
                                '/auth/v2-sign-inc': 'signin',
                                '/otp/verifySigninOtpc': 'verifyOtp',
                                '/slots/': 'reserveSlotc',
                                '/appointment/get-booking-configc': 'getBooking',
                                '/payment/': 'dgPay',
                                '/file/upload_file_v2c': 'uploadFile',
                                '/file/over-view-v3c': 'overview',
                                '/invoice/': 'invoice',
                                '/profile': 'profile',
                                '/appointment$': 'appointment',
                                '/appointment/appointment-booking-configc': 'bookingConfig',
                                '/high-commissions': 'highCommissions',
                                '/ivac-centers/': 'ivacCenters'
                            };

                            for (const [pattern, key] of Object.entries(mappings)) {
                                if (path.includes(pattern.replace('/', '')) || path.match(new RegExp(pattern))) {
                                    const baseUrl = `${parsed.origin}${path}`;
                                    urls[key] = baseUrl;
                                    break;
                                }
                            }
                        });

                        if (!Object.keys(urls).length) {
                            status.textContent = '⚠️ No matching API endpoints found';
                            status.style.color = '#d97706';
                            return;
                        }

                        let count = 0;
                        Object.entries(urls).forEach(([key, url]) => {
                            const input = document.getElementById(`sb-api-f-${key}`);
                            if (input) {
                                input.value = url;
                                input.style.background = '#f0fdf4';
                                input.style.borderColor = '#86efac';
                                setTimeout(() => {
                                    input.style.background = '';
                                    input.style.borderColor = '';
                                }, 3000);
                                count++;
                            }
                        });

                        status.textContent = `✅ ${count} endpoints detected from HAR`;
                        status.style.color = '#14a800';
                        preview.style.display = 'block';
                        preview.innerHTML = Object.entries(urls)
                            .map(([key, url]) => `<div style="font-size:10px;color:#1e293b;">✅ ${key}: ${url}</div>`)
                            .join('');

                        log(`HAR import: ${count} APIs detected`, 'ok');

                    } catch (err) {
                        status.textContent = `❌ Parse error: ${err.message}`;
                        status.style.color = '#e11d48';
                        console.error('HAR Parse Error:', err);
                    }
                };
                reader.readAsText(file);
            });

            // ─── Profile functions ─────────────────────────────────────
            function populateProfiles() {
                const sel = document.getElementById('sb-profile-select');
                if (!sel) return;
                const profiles = ProfileManager.load();
                const lastIdx = ProfileManager._lastIdx;
                sel.innerHTML = '<option value="">Select profile...</option>';
                profiles.forEach((p, i) => {
                    const opt = document.createElement('option');
                    opt.value = String(i);
                    opt.textContent = ProfileManager.getProfileLabel(p, i, String(i) === String(lastIdx));
                    sel.appendChild(opt);
                });
                if (lastIdx !== '' && profiles[lastIdx]) {
                    sel.value = lastIdx;
                    const p = profiles[lastIdx];
                    CONFIG.phone = p.phone;
                    CONFIG.password = p.password;
                    const phoneEl = document.getElementById('sb-phone');
                    const passEl = document.getElementById('sb-pass');
                    if (phoneEl) phoneEl.value = p.phone;
                    if (passEl) passEl.value = p.password;
                } else {
                    CONFIG.phone = '';
                    CONFIG.password = '';
                    const phoneEl = document.getElementById('sb-phone');
                    const passEl = document.getElementById('sb-pass');
                    if (phoneEl) phoneEl.value = '';
                    if (passEl) passEl.value = '';
                }
            }

            populateProfiles();
            window._refreshSlotBDProfiles = populateProfiles;

            document.getElementById('sb-profile-settings')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const sel = document.getElementById('sb-profile-select');
                if (window._openIvacProfileModal) window._openIvacProfileModal(sel ? sel.value : '');
            });

            document.getElementById('sb-profile-select').addEventListener('change', function() {
                const idx = this.value;
                if (idx === '') {
                    // Temporary mode: কোনো প্রোফাইল নেই, form খালি, ফাইল খালি
                    ProfileManager.clearLast();
                    CONFIG.phone = '';
                    CONFIG.password = '';
                    const phoneEl0 = document.getElementById('sb-phone');
                    const passEl0 = document.getElementById('sb-pass');
                    if (phoneEl0) phoneEl0.value = '';
                    if (passEl0) passEl0.value = '';
                    SharedProfile.set('', '');
                    const manualSel0 = document.getElementById('manual-profile-select');
                    if (manualSel0) manualSel0.value = '';
                    const nameEl0 = document.getElementById('global-profile-name');
                    const phoneEl02 = document.getElementById('global-profile-phone');
                    if (nameEl0) nameEl0.textContent = '—';
                    if (phoneEl02) phoneEl02.textContent = 'No profile';
                    if (window._ivacOnProfileChange) window._ivacOnProfileChange('');
                    if (window._refreshManualProfiles) window._refreshManualProfiles();
                    if (window._updateUploadProfileDisplay) window._updateUploadProfileDisplay();
                    log('Temporary mode: no profile selected', 'ok');
                    return;
                }
                const profiles = ProfileManager.load();
                const p = profiles[idx];
                if (!p) return;

                CONFIG.phone = p.phone;
                CONFIG.password = p.password;
                const phoneEl = document.getElementById('sb-phone');
                const passEl = document.getElementById('sb-pass');
                if (phoneEl) phoneEl.value = p.phone;
                if (passEl) passEl.value = p.password;
                ProfileManager.setLast(idx);
                SharedProfile.set(p.phone, p.password);
                log(`Profile loaded: ${p.name || p.phone}`, 'ok');

                const manualSel = document.getElementById('manual-profile-select');
                if (manualSel) manualSel.value = idx;

                const nameEl = document.getElementById('global-profile-name');
                const phoneEl2 = document.getElementById('global-profile-phone');
                if (nameEl) nameEl.textContent = p.name || '—';
                if (phoneEl2) phoneEl2.textContent = p.phone;

                if (window._refreshManualProfiles) window._refreshManualProfiles();
                if (window._updateUploadProfileDisplay) window._updateUploadProfileDisplay();
            });

            // ─── Init ──────────────────────────────────────────────────
            setInterval(updateBadge, 1000);
            renderTurnstile();

            function updateGlobalProfileDisplay() {
                try {
                    const profiles = ProfileManager.load();
                    const lastIdx = ProfileManager._lastIdx;
                    const nameEl = document.getElementById('global-profile-name');
                    const phoneEl = document.getElementById('global-profile-phone');

                    if (lastIdx !== '' && profiles[lastIdx]) {
                        const p = profiles[lastIdx];
                        if (nameEl) nameEl.textContent = p.name || '—';
                        if (phoneEl) phoneEl.textContent = p.phone;
                    } else {
                        if (nameEl) nameEl.textContent = '—';
                        if (phoneEl) phoneEl.textContent = 'No profile';
                    }
                } catch (e) {
                    console.error('[IVAC] Global profile display error:', e);
                }
            }

            function updateUploadProfileDisplay() {
                try {
                    const profiles = ProfileManager.load();
                    const lastIdx = ProfileManager._lastIdx;
                    const card = document.getElementById('upload-profile-card');
                    if (!card) return;

                    if (lastIdx !== '' && profiles[lastIdx]) {
                        const p = profiles[lastIdx];
                        card.style.display = 'flex';
                        const nameEl = document.getElementById('upload-profile-name');
                        const phoneEl = document.getElementById('upload-profile-phone');
                        if (nameEl) nameEl.textContent = p.name || '—';
                        if (phoneEl) phoneEl.textContent = p.phone;
                    } else {
                        card.style.display = 'none';
                    }
                } catch (e) {}
            }

            window._updateUploadProfileDisplay = updateUploadProfileDisplay;
            updateGlobalProfileDisplay();
            updateUploadProfileDisplay();

            log('SlotBD Panel loaded  Dynamic API', 'ok');
        }

        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
        else createUI();
    }

    // ─── Initialize Everything ──────────────────────────────────────

    // Initialize Enhanced Dynamic API Manager
    const manager = initEnhancedDynamicApiManager();
    console.log('[IVAC] ✅ Enhanced Dynamic API Integration loaded!');
    console.log('[IVAC] Use 🔗 button in SlotBD tab to manage APIs');

})();




//-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/*
// ==UserScript==
// @name         upload & date & initite  Manual
// @namespace    ivac-serial-uploader-fixed
// @version      5.9.3
// @description  v5.9.3 panel on all IVAC pages; upload automation/observer only on exact file-upload page
// @match        https://appointment.ivacbd.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

*/

(async function () {
    'use strict';

    /***************************************************************
     * EARLY START
     *
     * Full page load-এর জন্য অপেক্ষা করবে না।
     * শুধু <body> তৈরি হলেই automation initialize হবে।
     * এরপর MutationObserver button/element আসামাত্র detect করবে,
     * আর 10-second scanner backup হিসেবে চলবে।
     ***************************************************************/

    if (!document.body) {
        await new Promise(resolve => {
            const bodyObserver = new MutationObserver(() => {
                if (document.body) {
                    bodyObserver.disconnect();
                    resolve();
                }
            });

            bodyObserver.observe(
                document.documentElement || document,
                {
                    childList: true,
                    subtree: true
                }
            );
        });
    }

    /***************************************************************
     * SETTINGS
     ***************************************************************/

    const PRIMARY_LABEL =
        "upload primary applicant's webfile";

    const OTHER_LABEL =
        "upload other applicant's webfile";

    const CONFIRM_TEXT =
        "confirm all information is correct";

    const DEFAULT_REQUIRED_TOTAL = 4;

    function clampRequiredTotal(value) {

        const number =
            parseInt(value, 10);


        if (
            Number.isNaN(number) ||
            number < 1 ||
            number > 4
        ) {

            return DEFAULT_REQUIRED_TOTAL;
        }


        return number;
    }


    let requiredTotal =
        clampRequiredTotal(
            GM_getValue(
                'IVAC_REQUIRED_TOTAL',
                DEFAULT_REQUIRED_TOTAL
            )
        );

    const MAX_FILE_SIZE =
        500 * 1024;

    // প্রতি 1 second-এ continuous backup check
    // AUTO ON থাকলে tab/page খোলা থাকা পর্যন্ত চলতেই থাকবে
    // প্রতি 1 second-এ backup check।
    // MutationObserver element/error আসলে আরও দ্রুত runAutomation() চালাবে।
    const CHECK_INTERVAL = 1 * 1000;

    // কোনো নতুন upload error detect হলে SAME FILE আবার try করার আগে
    // minimum 5 seconds break নেবে।
    const ERROR_RETRY_DELAY = 5 * 1000;

    // Upload automation is allowed to scan/run ONLY on this exact page.
    // The control panel still remains visible on every IVAC page.
    const FILE_UPLOAD_PATH = '/appointment/file-upload';

    function isFileUploadPage() {
        try {
            const path = location.pathname.replace(/\/+$/, '') || '/';
            return (
                location.hostname === 'appointment.ivacbd.com' &&
                path === FILE_UPLOAD_PATH
            );
        } catch (error) {
            return false;
        }
    }


    /***************************************************************
     * DATABASE
     ***************************************************************/

    const DB_NAME =
        'IVAC_4_APPLICANTS_DB';

    const STORE_NAME =
        'webfiles';


    const FILES = [
        {
            key: 'primary',
            title: 'Primary'
        },
        {
            key: 'other1',
            title: 'Secondary 1'
        },
        {
            key: 'other2',
            title: 'Secondary 2'
        },
        {
            key: 'other3',
            title: 'Secondary 3'
        }
    ];


    /***************************************************************
     * PERSISTENT RUNTIME STATE
     *
     * Keeps exact serial position across reload/navigation:
     * - current stage
     * - pending stage
     * - pending filename
     * - expected count
     *
     * DOM elements themselves are NOT saved; they are re-detected
     * after reload.
     ***************************************************************/

    const RUNTIME_STATE_KEY =
        'IVAC_UPLOAD_RUNTIME_STATE_V57';


    /***************************************************************
     * STATE
     ***************************************************************/

    // AUTO ON/OFF state reload/new page-এর পরও মনে থাকবে।
    // First use-এ default ON; পরে user যে state রাখবে সেটাই restore হবে।
    let autoEnabled =
        GM_getValue(
            'IVAC_MASTER_AUTO_ENABLED',
            true
        );


    /*
     * stage:
     *
     * 0 = Primary
     * 1 = Other 1
     * 2 = Other 2
     * 3 = Other 3
     * 4 = Complete / Confirm
     */

    let stage = 0;


    /*
     * Upload পাঠানোর পর
     * server/next stage-এর জন্য wait করবে।
     */

    let waitingUpload = null;

    // Reload হলে persisted pending data আগে এখানে থাকবে।
    // Page-এর নতুন DOM ready হলে runAutomation() এটাকে hydrate করবে।
    let restoredPendingState = null;

    let processing = false;

    let confirmClicked = false;

    // Upload error detect হলে এই সময় পর্যন্ত নতুন retry attach বন্ধ থাকবে।
    let errorRetryUntil = 0;


    function sanitizeStage(value) {

        const number =
            parseInt(value, 10);


        if (Number.isNaN(number)) {
            return 0;
        }


        return Math.max(
            0,
            Math.min(
                requiredTotal,
                number
            )
        );
    }


    function serializePendingState(pending) {

        if (!pending) {
            return null;
        }


        return {
            stage:
                sanitizeStage(
                    pending.stage
                ),

            expectedTotal:
                parseInt(
                    pending.expectedTotal,
                    10
                ) || (
                    sanitizeStage(
                        pending.stage
                    ) + 1
                ),

            baselineTotal:
                pending.baselineTotal ?? null,

            fileName:
                pending.fileName || '',

            startedAt:
                pending.startedAt || Date.now(),

            sawOtherButtonMissing:
                Boolean(
                    pending.sawOtherButtonMissing
                ),

            errorAtSend:
                pending.errorAtSend || null,

            errorClearedSinceSend:
                Boolean(
                    pending.errorClearedSinceSend
                )
        };
    }


    function persistRuntimeState() {

        const pendingSource =
            waitingUpload ||
            restoredPendingState;


        GM_setValue(
            RUNTIME_STATE_KEY,
            {
                requiredTotal:
                    requiredTotal,

                stage:
                    sanitizeStage(
                        stage
                    ),

                pending:
                    serializePendingState(
                        pendingSource
                    ),

                updatedAt:
                    Date.now()
            }
        );
    }


    function clearRuntimeState() {

        GM_setValue(
            RUNTIME_STATE_KEY,
            null
        );


        restoredPendingState =
            null;
    }


    function restoreRuntimeStateFromStorage() {

        const saved =
            GM_getValue(
                RUNTIME_STATE_KEY,
                null
            );


        if (
            !saved ||
            typeof saved !== 'object' ||
            parseInt(
                saved.requiredTotal,
                10
            ) !== requiredTotal
        ) {

            return false;
        }


        stage =
            sanitizeStage(
                saved.stage
            );


        restoredPendingState =
            saved.pending &&
            typeof saved.pending === 'object'
                ? serializePendingState(
                    saved.pending
                )
                : null;


        console.log(
            '[IVAC RESTORE]',
            '| Stage:',
            stage,
            '| Pending:',
            restoredPendingState
                ? `${FILES[restoredPendingState.stage]?.title || restoredPendingState.stage} / ${restoredPendingState.fileName}`
                : 'NO'
        );


        return true;
    }


    /***************************************************************
     * HELPERS
     ***************************************************************/

    function normalize(text) {

        return (text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function isVisible(element) {

        if (!element) {
            return false;
        }


        const style =
            window.getComputedStyle(
                element
            );


        if (
            style.display === 'none' ||
            style.visibility === 'hidden'
        ) {

            return false;
        }


        const rect =
            element.getBoundingClientRect();


        return (
            rect.width > 0 &&
            rect.height > 0
        );
    }


    /***************************************************************
     * PDF NAME MATCH FOR "FILE ALREADY EXISTS"
     *
     * Example:
     * 1-ASIT BARAN PAUL.pdf -> ASIT BARAN
     * 2-SAJAL BISWAS.pdf    -> SAJAL BISWAS
     *
     * Only the FIRST TWO name-parts are used.
     * Leading serial number (1-, 2-, 3-, 4-) and .pdf are ignored.
     *
     * IMPORTANT:
     * Search only visible page text that actually contains ".pdf".
     * The script's own FILES/setup panel is excluded, so a locally
     * saved filename cannot create a false "already uploaded" match.
     ***************************************************************/

    function getPdfFirstTwoNameParts(fileName) {

        const cleaned =
            (fileName || '')
                .replace(/\.pdf$/i, '')
                .replace(/^\s*\d+\s*[-_. ]+\s*/, '')
                .replace(/[_-]+/g, ' ')
                .replace(/[^a-zA-Z0-9 ]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .toUpperCase();


        const parts =
            cleaned
                .split(' ')
                .filter(Boolean);


        return parts
            .slice(0, 2);
    }


    function uploadedPdfNameMatches(fileName) {

        const keyParts =
            getPdfFirstTwoNameParts(
                fileName
            );


        if (
            keyParts.length < 2
        ) {

            return false;
        }


        const walker =
            document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT
            );


        let node;


        while (
            (node = walker.nextNode())
        ) {

            const parent =
                node.parentElement;


            if (!parent) {
                continue;
            }


            if (
                parent.closest(
                    '#ivac-auto-panel, #ivac-file-setup-window'
                )
            ) {
                continue;
            }


            if (
                !isVisible(parent)
            ) {
                continue;
            }


            const rawText =
                (node.nodeValue || '')
                    .trim();


            /*
             * Applicant-name cards do not prove upload.
             * Require an actual visible PDF filename/text.
             */
            if (
                !/\.pdf\b/i.test(
                    rawText
                )
            ) {
                continue;
            }


            const normalized =
                rawText
                    .replace(/[_-]+/g, ' ')
                    .replace(/[^a-zA-Z0-9. ]+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toUpperCase();


            const firstMatches =
                normalized.includes(
                    keyParts[0]
                );


            const secondMatches =
                normalized.includes(
                    keyParts[1]
                );


            if (
                firstMatches &&
                secondMatches
            ) {

                console.log(
                    '[IVAC PDF MATCH]',
                    fileName,
                    '=>',
                    keyParts.join(' '),
                    '| Found:',
                    rawText
                );


                return true;
            }
        }


        return false;
    }


    /***************************************************************
     * APPLICANT NAME RECONCILIATION — v5.9
     *
     * Problem solved:
     *
     * Count alone cannot tell WHICH saved file is missing.
     *
     * Example:
     *   Saved:
     *     PRIMARY = PIPASHA BISWAS
     *     OTHER 1 = SUNIL CHANDRA PAUL
     *     OTHER 2 = UNNOTI RANI PAUL
     *
     *   Page currently shows:
     *     PIPASHA BISWAS
     *     UNNOTI RANI PAUL
     *
     *   Total = 2
     *
     * Old serial/count logic would assume PRIMARY + OTHER 1 exist
     * and try OTHER 2 again.
     *
     * v5.9 reads the visible applicant-name cards, compares those
     * names with the saved PDF filenames, and selects the ACTUAL
     * missing slot (OTHER 1 in the example above).
     ***************************************************************/

    function normalizePersonName(text) {

        return (text || '')
            .replace(/\.pdf$/i, '')
            .replace(/^\s*\d+\s*[-_. ]+\s*/, '')
            .replace(/[_-]+/g, ' ')
            .replace(/[^a-zA-Z0-9 ]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();
    }


    function applicantNameMatchesFileName(
        fileName,
        applicantName
    ) {

        const filePerson =
            normalizePersonName(
                fileName
            );


        const pagePerson =
            normalizePersonName(
                applicantName
            );


        if (
            !filePerson ||
            !pagePerson
        ) {

            return false;
        }


        /*
         * Strongest match: full normalized filename-person
         * is present in the applicant card name.
         */
        if (
            pagePerson === filePerson ||
            pagePerson.includes(filePerson) ||
            filePerson.includes(pagePerson)
        ) {

            return true;
        }


        /*
         * Fallback: first two filename name-parts.
         * This keeps compatibility with filenames that may contain
         * an extra third/fourth name while the card is abbreviated.
         */
        const firstTwo =
            getPdfFirstTwoNameParts(
                fileName
            );


        if (
            firstTwo.length < 2
        ) {

            return false;
        }


        const phrase =
            firstTwo.join(' ');


        return pagePerson.includes(
            phrase
        );
    }


    function getVisibleApplicantNames() {

        const names = [];

        /*
         * Current IVAC UI uses clickable cards/buttons such as:
         *   Primary Applicant / PIPASHA BISWAS
         *   Applicant 02     / UNNOTI RANI PAUL
         *
         * Only visible page cards are read.
         * Our own userscript panels are excluded.
         */
        const candidates =
            Array.from(
                document.querySelectorAll(
                    'button, [role="button"]'
                )
            );


        for (const element of candidates) {

            if (
                !isVisible(element) ||
                element.closest(
                    '#ivac-auto-panel, #ivac-file-setup-window'
                )
            ) {

                continue;
            }


            const raw =
                (element.innerText ||
                    element.textContent ||
                    '')
                    .replace(/\s+/g, ' ')
                    .trim();


            if (!raw) {
                continue;
            }


            const lower =
                raw.toLowerCase();


            const looksLikeApplicantCard =
                lower.includes(
                    'primary applicant'
                ) ||
                /\bapplicant\s*0*\d+\b/i
                    .test(raw);


            if (!looksLikeApplicantCard) {
                continue;
            }


            /*
             * Prefer separate span text because the current UI stores
             * the label and applicant name in separate spans.
             */
            const spanTexts =
                Array.from(
                    element.querySelectorAll(
                        'span'
                    )
                )
                .filter(
                    span =>
                        isVisible(span)
                )
                .map(
                    span =>
                        (span.textContent || '')
                            .replace(/\s+/g, ' ')
                            .trim()
                )
                .filter(Boolean);


            let personName =
                spanTexts.find(
                    value => {

                        const normalized =
                            normalize(
                                value
                            );


                        return (
                            normalized !==
                                'primary applicant' &&
                            !/^applicant\s*0*\d+$/i
                                .test(value)
                        );
                    }
                ) || '';


            /*
             * Fallback when spans are unavailable.
             */
            if (!personName) {

                personName =
                    raw
                        .replace(
                            /primary\s+applicant/ig,
                            ' '
                        )
                        .replace(
                            /applicant\s*0*\d+/ig,
                            ' '
                        )
                        .replace(/\s+/g, ' ')
                        .trim();
            }


            const normalizedName =
                normalizePersonName(
                    personName
                );


            if (
                normalizedName &&
                !names.includes(
                    normalizedName
                )
            ) {

                names.push(
                    normalizedName
                );
            }
        }


        return names;
    }


    async function getApplicantNameReconciliation() {

        const total =
            getTotalApplicants();


        const applicantNames =
            getVisibleApplicantNames();


        /*
         * No name cards = no name-based decision.
         * The old serial/count logic remains the fallback.
         */
        if (!applicantNames.length) {

            return {
                usable: false,
                syncing: false,
                total,
                applicantNames,
                matchedIndexes: [],
                missingIndexes: []
            };
        }


        /*
         * If Total says 3 but only 2 cards are currently rendered,
         * the page is likely still updating after an upload.
         * Do not make a missing-file decision from stale DOM.
         */
        if (
            total !== null &&
            applicantNames.length !== total
        ) {

            return {
                usable: false,
                syncing: true,
                total,
                applicantNames,
                matchedIndexes: [],
                missingIndexes: []
            };
        }


        const matchedIndexes = [];
        const missingIndexes = [];


        for (
            let i = 0;
            i < requiredTotal;
            i++
        ) {

            const record =
                await getSavedRecord(
                    FILES[i].key
                );


            if (
                !record ||
                !record.name
            ) {

                missingIndexes.push(
                    i
                );

                continue;
            }


            const found =
                applicantNames.some(
                    applicantName =>
                        applicantNameMatchesFileName(
                            record.name,
                            applicantName
                        )
                );


            if (found) {

                matchedIndexes.push(
                    i
                );

            } else {

                missingIndexes.push(
                    i
                );
            }
        }


        /*
         * Require at least one real filename-to-card match before
         * allowing this mode to override the serial stage.
         */
        const usable =
            matchedIndexes.length > 0 ||
            (
                total === 0 &&
                applicantNames.length === 0
            );


        return {
            usable,
            syncing: false,
            total,
            applicantNames,
            matchedIndexes,
            missingIndexes
        };
    }


    async function syncStageFromApplicantNames() {

        const result =
            await getApplicantNameReconciliation();


        if (!result.usable) {

            return result;
        }


        if (
            result.missingIndexes.length === 0
        ) {

            if (
                result.total === requiredTotal
            ) {

                if (
                    stage !== requiredTotal
                ) {

                    console.log(
                        '[IVAC NAME CHECK] ALL REQUIRED NAMES FOUND → COMPLETE',
                        '| Names:',
                        result.applicantNames
                    );


                    stage =
                        requiredTotal;


                    persistRuntimeState();
                }
            }


            return result;
        }


        const actualMissingStage =
            result.missingIndexes[0];


        if (
            stage !== actualMissingStage
        ) {

            console.log(
                '[IVAC NAME CHECK] SERIAL STAGE CORRECTED',
                '| Old:',
                stage,
                '| New:',
                actualMissingStage,
                '| Missing:',
                FILES[actualMissingStage]?.title,
                '| Visible Names:',
                result.applicantNames
            );


            stage =
                actualMissingStage;


            persistRuntimeState();


            setStatus(
                `NAME CHECK → MISSING ${FILES[actualMissingStage].title}`,
                '#cc7900'
            );
        }


        return result;
    }


    /***************************************************************
     * DATABASE
     ***************************************************************/

    function openDB() {

        return new Promise(
            (resolve, reject) => {

                const request =
                    indexedDB.open(
                        DB_NAME,
                        1
                    );


                request.onupgradeneeded =
                    event => {

                        const db =
                            event.target.result;


                        if (
                            !db.objectStoreNames
                                .contains(
                                    STORE_NAME
                                )
                        ) {

                            db.createObjectStore(
                                STORE_NAME
                            );
                        }
                    };


                request.onsuccess =
                    () =>
                        resolve(
                            request.result
                        );


                request.onerror =
                    () =>
                        reject(
                            request.error
                        );
            }
        );
    }


    async function saveFile(
        slotKey,
        file
    ) {

        const buffer =
            await file.arrayBuffer();


        const record = {

            name:
                file.name,

            type:
                file.type ||
                'application/pdf',

            size:
                file.size,

            lastModified:
                file.lastModified,

            data:
                buffer
        };


        const db =
            await openDB();


        return new Promise(
            (resolve, reject) => {

                const tx =
                    db.transaction(
                        STORE_NAME,
                        'readwrite'
                    );


                const store =
                    tx.objectStore(
                        STORE_NAME
                    );


                const request =
                    store.put(
                        record,
                        slotKey
                    );


                request.onsuccess =
                    () => resolve();


                request.onerror =
                    () =>
                        reject(
                            request.error
                        );
            }
        );
    }


    async function getSavedRecord(
        slotKey
    ) {

        const db =
            await openDB();


        return new Promise(
            (resolve, reject) => {

                const tx =
                    db.transaction(
                        STORE_NAME,
                        'readonly'
                    );


                const store =
                    tx.objectStore(
                        STORE_NAME
                    );


                const request =
                    store.get(
                        slotKey
                    );


                request.onsuccess =
                    () =>
                        resolve(
                            request.result ||
                            null
                        );


                request.onerror =
                    () =>
                        reject(
                            request.error
                        );
            }
        );
    }


    async function loadFile(
        slotKey
    ) {

        const record =
            await getSavedRecord(
                slotKey
            );


        if (!record) {
            return null;
        }


        return new File(
            [record.data],
            record.name,
            {
                type:
                    record.type ||
                    'application/pdf',

                lastModified:
                    record.lastModified ||
                    Date.now()
            }
        );
    }


    /***************************************************************
     * FILE VALIDATION
     ***************************************************************/

    function validateFile(file) {

        if (!file) {

            return {
                ok: false,
                reason: 'FILE NOT SET'
            };
        }


        const pdf =
            file.type ===
                'application/pdf' ||

            file.name
                .toLowerCase()
                .endsWith('.pdf');


        if (!pdf) {

            return {
                ok: false,
                reason: 'NOT PDF'
            };
        }


        if (
            file.size >
            MAX_FILE_SIZE
        ) {

            return {
                ok: false,
                reason: '>500KB'
            };
        }


        return {
            ok: true
        };
    }


    async function allFilesReady() {

        for (
            let i = 0;
            i < requiredTotal;
            i++
        ) {

            const file =
                await loadFile(
                    FILES[i].key
                );


            const result =
                validateFile(file);


            if (!result.ok) {
                return false;
            }
        }


        return true;
    }


    /***************************************************************
     * GET TOTAL APPLICANTS
     ***************************************************************/

    function getTotalApplicants() {

        const paragraphs =
            Array.from(
                document.querySelectorAll(
                    'p'
                )
            );


        for (const p of paragraphs) {

            const text =
                normalize(
                    p.textContent
                );


            if (
                !text.includes(
                    'total number of applicants'
                )
            ) {

                continue;
            }


            const span =
                p.querySelector(
                    'span'
                );


            if (span) {

                const number =
                    parseInt(
                        span.textContent.trim(),
                        10
                    );


                if (
                    !Number.isNaN(number)
                ) {

                    return number;
                }
            }


            const match =
                text.match(
                    /total number of applicants\s*:\s*(\d+)/
                );


            if (match) {

                return parseInt(
                    match[1],
                    10
                );
            }
        }


        return null;
    }


    /***************************************************************
     * FIND INPUT RELATED TO LABEL
     ***************************************************************/

    function resolveInputForLabel(label) {

        if (!label) {
            return null;
        }


        /*
         * label for=""
         */

        if (label.htmlFor) {

            const direct =
                document.getElementById(
                    label.htmlFor
                );


            if (
                direct &&
                direct.matches(
                    'input[type="file"]'
                )
            ) {

                return direct;
            }
        }


        /*
         * Inside label
         */

        const inside =
            label.querySelector(
                'input[type="file"]'
            );


        if (inside) {
            return inside;
        }


        /*
         * Upload box sibling
         */

        const box =
            label.parentElement;


        if (box) {

            const next =
                box.nextElementSibling;


            if (
                next &&
                next.matches?.(
                    'input[type="file"]'
                )
            ) {

                return next;
            }


            const previous =
                box.previousElementSibling;


            if (
                previous &&
                previous.matches?.(
                    'input[type="file"]'
                )
            ) {

                return previous;
            }
        }


        /*
         * Search parents
         */

        let parent =
            box;


        for (
            let depth = 0;
            depth < 8 &&
            parent;
            depth++
        ) {

            const inputs =
                Array.from(
                    parent.querySelectorAll(
                        'input[type="file"]'
                    )
                ).filter(
                    input =>
                        input.id !==
                        'ivac-file-setup-picker'
                );


            if (
                inputs.length === 1
            ) {

                return inputs[0];
            }


            parent =
                parent.parentElement;
        }


        return null;
    }


    /***************************************************************
     * FIND UPLOAD BUTTON
     ***************************************************************/

    function findUploader(
        targetText
    ) {

        const labels =
            Array.from(
                document.querySelectorAll(
                    'label'
                )
            );


        for (const label of labels) {

            if (
                !normalize(
                    label.textContent
                ).includes(
                    targetText
                )
            ) {

                continue;
            }


            if (
                !isVisible(label)
            ) {

                continue;
            }


            const input =
                resolveInputForLabel(
                    label
                );


            if (!input) {
                continue;
            }


            if (input.disabled) {
                continue;
            }


            return {
                label,
                input,
                control:
                    label.parentElement
            };
        }


        return null;
    }


    function getPrimaryUploader() {

        return findUploader(
            PRIMARY_LABEL
        );
    }


    function getOtherUploader() {

        return findUploader(
            OTHER_LABEL
        );
    }


    /***************************************************************
     * HYDRATE SAVED PENDING AFTER RELOAD
     *
     * The saved pending stage/file survives reload.
     * New page DOM elements are attached again here.
     ***************************************************************/

    function hydrateRestoredPendingIfNeeded() {

        if (
            waitingUpload ||
            !restoredPendingState
        ) {

            return;
        }


        const pending =
            serializePendingState(
                restoredPendingState
            );


        const uploader =
            pending.stage === 0
                ? getPrimaryUploader()
                : getOtherUploader();


        waitingUpload = {

            stage:
                pending.stage,

            expectedTotal:
                pending.expectedTotal,

            baselineTotal:
                pending.baselineTotal,

            control:
                uploader
                    ? uploader.control
                    : null,

            label:
                uploader
                    ? uploader.label
                    : null,

            /*
             * Intentionally null after reload.
             * A visible OTHER button after a restored pending upload
             * can act as the next-ready signal after count/error checks.
             */
            input:
                null,

            fileName:
                pending.fileName,

            startedAt:
                pending.startedAt,

            sawOtherButtonMissing:
                pending.sawOtherButtonMissing,

            errorAtSend:
                pending.errorAtSend,

            errorClearedSinceSend:
                pending.errorClearedSinceSend,

            restoredFromReload:
                true
        };


        restoredPendingState =
            null;


        persistRuntimeState();


        console.log(
            '[IVAC PENDING RESTORED]',
            FILES[waitingUpload.stage]?.title,
            '| File:',
            waitingUpload.fileName,
            '| Expected:',
            waitingUpload.expectedTotal
        );
    }


    /***************************************************************
     * CONFIRM BUTTON
     ***************************************************************/

    function findConfirmButton() {

        return Array.from(
            document.querySelectorAll(
                'button'
            )
        ).find(
            button =>
                normalize(
                    button.textContent
                ).includes(
                    CONFIRM_TEXT
                )
        ) || null;
    }


    function confirmEnabled(button) {

        if (!button) {
            return false;
        }


        if (button.disabled) {
            return false;
        }


        if (
            button.getAttribute(
                'aria-disabled'
            ) === 'true'
        ) {

            return false;
        }


        return true;
    }


    /***************************************************************
     * FIND VISIBLE UPLOAD ERROR
     *
     * Examples handled:
     * - File already exists.. Try again
     * - Uploads are currently closed.. Try again
     * - Other visible red upload errors in the same upload area
     ***************************************************************/

    function getVisibleUploadError(control = null) {

        const collectVisibleErrors = root => {

            if (!root || !root.querySelectorAll) {
                return [];
            }


            return Array.from(
                root.querySelectorAll(
                    '[class*="text-red-500"]'
                )
            ).filter(
                node =>
                    isVisible(node) &&
                    normalize(node.textContent)
            );
        };


        /*
         * First preference: current uploader-এর আশেপাশের error.
         */

        if (control) {

            let parent = control;


            for (
                let depth = 0;
                depth < 5 && parent;
                depth++
            ) {

                const errors =
                    collectVisibleErrors(parent);


                if (errors.length) {

                    return normalize(
                        errors[0].textContent
                    );
                }


                parent =
                    parent.parentElement;
            }
        }


        /*
         * Fallback: page-এর visible red upload-like error.
         */

        const globalErrors =
            collectVisibleErrors(document);


        for (const node of globalErrors) {

            const message =
                normalize(node.textContent);


            if (
                message.includes('file') ||
                message.includes('upload') ||
                message.includes('try again') ||
                message.includes('currently closed')
            ) {

                return message;
            }
        }


        return null;
    }


    /***************************************************************
     * ATTACH FILE
     *
     * IMPORTANT FIX:
     *
     * input.files আগের file থাকলেও
     * blocker নয়।
     *
     * input clear করে নতুন stage-এর file বসাবে।
     ***************************************************************/

    async function attachFile(
        uploader,
        fileIndex
    ) {

        if (!uploader) {
            return false;
        }


        const input =
            uploader.input;


        if (!input) {
            return false;
        }


        const slot =
            FILES[fileIndex];


        const file =
            await loadFile(
                slot.key
            );


        const result =
            validateFile(
                file
            );


        if (!result.ok) {

            setStatus(
                `${slot.title}: ${result.reason}`,
                '#d62828'
            );


            return false;
        }


        /*
         * CLEAR OLD FILE
         *
         * Website same input reuse করলেও
         * আগের file remove হবে।
         */

        try {

            input.value =
                '';

        } catch (error) {

            console.log(
                '[IVAC] input.value clear skipped'
            );
        }


        /*
         * NEW FILELIST
         */

        const dt =
            new DataTransfer();


        dt.items.add(
            file
        );


        try {

            input.files =
                dt.files;

        } catch (error) {

            const descriptor =
                Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype,
                    'files'
                );


            if (
                descriptor &&
                descriptor.set
            ) {

                descriptor.set.call(
                    input,
                    dt.files
                );

            } else {

                throw error;
            }
        }


        /*
         * React/browser events
         */

        input.dispatchEvent(
            new Event(
                'input',
                {
                    bubbles: true
                }
            )
        );


        input.dispatchEvent(
            new Event(
                'change',
                {
                    bubbles: true
                }
            )
        );


        waitingUpload = {

            stage:
                fileIndex,

            // এই stage complete হলে expected count = stage + 1
            expectedTotal:
                fileIndex + 1,

            baselineTotal:
                getTotalApplicants(),

            control:
                uploader.control,

            label:
                uploader.label,

            input:
                input,

            fileName:
                file.name,

            startedAt:
                Date.now(),

            // OTHER button একই label reuse করলে disappear -> reappear
            // অথবা নতুন input element এলে next-button ready ধরা হবে।
            sawOtherButtonMissing:
                false,

            // Retry-এর সময় পুরনো error DOM-এ থেকে গেলে সেটাকে নতুন error
            // হিসেবে সঙ্গে সঙ্গে আবার ধরবে না।
            errorAtSend:
                getVisibleUploadError(
                    uploader.control
                ),

            errorClearedSinceSend:
                false,

            restoredFromReload:
                false
        };


        // Upload dispatch হওয়ার পর exact pending position persist।
        persistRuntimeState();


        setStatus(
            `${slot.title} SENT - WAIT`,
            '#1464c0'
        );


        console.log(
            `[IVAC UPLOAD] ${slot.title} SENT`,
            '| File:',
            file.name,
            '| Total:',
            waitingUpload.baselineTotal
        );


        return true;
    }


    /***************************************************************
     * CHECK CURRENT UPLOAD
     *
     * SUCCESS / RETRY ORDER:
     *
     * 1. Expected count reached -> success immediately
     * 2. Otherwise new upload error -> same file retry
     * 3. Otherwise next upload button ready -> next serial file
     * 4. Final Confirm only when total === selected upload count
     *
     ***************************************************************/

    async function checkWaitingUpload() {

        if (!waitingUpload) {
            return false;
        }


        const currentStage =
            waitingUpload.stage;

        const slot =
            FILES[currentStage];

        const total =
            getTotalApplicants();

        const otherUploader =
            getOtherUploader();


        /***********************************************************
         * RULE 1 — COUNT FIRST
         *
         * PRIMARY complete => count >= 1
         * OTHER 1 complete => count >= 2
         * OTHER 2 complete => count >= 3
         * OTHER 3 complete => count >= 4
         *
         * Count expected value-এ পৌঁছালে আর error/button check দরকার নেই।
         ***********************************************************/

        if (
            total !== null &&
            total >= waitingUpload.expectedTotal
        ) {

            console.log(
                `[IVAC SUCCESS] ${slot.title} COMPLETE ✓`,
                '| COUNT:',
                total,
                '| EXPECTED:',
                waitingUpload.expectedTotal
            );


            stage =
                currentStage + 1;

            waitingUpload =
                null;


            persistRuntimeState();


            setStatus(
                `${slot.title} COMPLETE ✓ | COUNT ${total}`,
                '#07883c'
            );


            return true;
        }


        /***********************************************************
         * Track OTHER button transition.
         *
         * For OTHER stages the same label can be reused, তাই শুধু
         * visible থাকলেই next-button বলা যাবে না।
         ***********************************************************/

        if (!otherUploader) {

            waitingUpload
                .sawOtherButtonMissing =
                true;
        }


        /***********************************************************
         * RULE 2 — COUNT না বাড়লে ERROR CHECK
         *
         * যেকোনো নতুন visible upload error এলে SAME FILE retry।
         ***********************************************************/

        const uploadError =
            getVisibleUploadError(
                waitingUpload.control
            );


        if (!uploadError) {

            waitingUpload
                .errorClearedSinceSend =
                true;
        }


        const isNewError =
            Boolean(uploadError) &&
            (
                !waitingUpload.errorAtSend ||
                uploadError !==
                    waitingUpload.errorAtSend ||
                waitingUpload
                    .errorClearedSinceSend
            );


        if (isNewError) {

            /********************************************************
             * SPECIAL CASE — FILE ALREADY EXISTS
             *
             * Count এখনও expected value-এ না পৌঁছালেও server busy হলে
             * uploaded file list একটু পরে show করতে পারে।
             *
             * তাই "File already exists" এলে current PDF-এর filename
             * থেকে প্রথম দুই name-part নিয়ে visible uploaded PDF list
             * এ match করা হবে।
             *
             * MATCH:
             *   Same file server/list-এ already আছে -> retry নয়,
             *   current stage complete ধরে NEXT stage.
             *
             * NO MATCH:
             *   আগের v5.5 behaviour -> SAME FILE retry.
             *
             * অন্য সব error:
             *   আগের v5.5 behaviour -> SAME FILE retry.
             ********************************************************/

            const fileAlreadyExists =
                uploadError.includes(
                    'file already exists'
                );


            if (fileAlreadyExists) {

                /*
                 * v5.9 PRIMARY FIX:
                 *
                 * Read visible applicant cards and determine exactly
                 * which saved filename is already present / missing.
                 *
                 * This allows a jump BACK to OTHER 1, for example,
                 * even when count/serial state had already moved to
                 * OTHER 2.
                 */
                const nameState =
                    await getApplicantNameReconciliation();


                if (
                    nameState.usable &&
                    nameState.matchedIndexes
                        .includes(
                            currentStage
                        )
                ) {

                    const actualMissingStage =
                        nameState.missingIndexes
                            .find(
                                index =>
                                    index !==
                                    currentStage
                            );


                    stage =
                        actualMissingStage ===
                            undefined
                            ? requiredTotal
                            : actualMissingStage;


                    console.log(
                        `[IVAC ALREADY EXISTS] ${slot.title} NAME MATCH ✓`,
                        '| Current file:',
                        waitingUpload.fileName,
                        '| Visible names:',
                        nameState.applicantNames,
                        '| Next actual missing:',
                        actualMissingStage === undefined
                            ? 'NONE'
                            : FILES[actualMissingStage]?.title
                    );


                    waitingUpload =
                        null;


                    persistRuntimeState();


                    setStatus(
                        actualMissingStage ===
                            undefined
                            ? `${slot.title} EXISTS ✓ | ALL NAMES FOUND`
                            : `${slot.title} EXISTS ✓ → MISSING ${FILES[actualMissingStage].title}`,
                        '#07883c'
                    );


                    return true;
                }


                /*
                 * Old v5.8 PDF-text fallback.
                 * Used only when applicant-card reconciliation is
                 * unavailable on the current page.
                 */
                if (
                    uploadedPdfNameMatches(
                        waitingUpload.fileName
                    )
                ) {

                    console.log(
                        `[IVAC ALREADY EXISTS] ${slot.title} PDF NAME MATCH ✓ → NEXT`,
                        '| File:',
                        waitingUpload.fileName,
                        '| Error:',
                        uploadError
                    );


                    stage =
                        currentStage + 1;


                    waitingUpload =
                        null;


                    persistRuntimeState();


                    setStatus(
                        `${slot.title} ALREADY UPLOADED ✓ → NEXT`,
                        '#07883c'
                    );


                    return true;
                }
            }


            console.log(
                `[IVAC ERROR] ${slot.title} → RETRY SAME FILE`,
                '| Error:',
                uploadError,
                fileAlreadyExists
                    ? '| PDF NAME MATCH: NO'
                    : ''
            );


            // Stage change হবে না।
            // Error detect হওয়ার পর minimum 5 seconds break নিয়ে
            // runAutomation() একই FILES[currentStage] আবার attach করবে।
            errorRetryUntil =
                Date.now() +
                ERROR_RETRY_DELAY;


            setStatus(
                fileAlreadyExists
                    ? `${slot.title} EXISTS BUT NAME NOT FOUND → RETRY IN 5S`
                    : `${slot.title} ERROR → RETRY IN 5S`,
                '#d62828'
            );


            waitingUpload =
                null;


            persistRuntimeState();


            return true;
        }


        /***********************************************************
         * RELOAD RECOVERY
         *
         * PRIMARY pending অবস্থায় reload হয়ে যদি আবার PRIMARY button
         * দেখা যায়, count/error/name কোনোটাই success দেখায়নি।
         * তাই same PRIMARY retry করবে।
         *
         * LAST file pending অবস্থায় reload হয়ে OTHER upload button
         * দেখা গেলে count এখনও final হয়নি; same last file retry করবে।
         ***********************************************************/

        if (
            waitingUpload.restoredFromReload &&
            currentStage === 0 &&
            getPrimaryUploader() &&
            !otherUploader
        ) {

            console.log(
                '[IVAC RESTORE] PRIMARY still pending → RETRY SAME'
            );


            setStatus(
                'PRIMARY RESTORED PENDING → RETRY SAME',
                '#cc7900'
            );


            waitingUpload =
                null;


            persistRuntimeState();


            return true;
        }


        if (
            waitingUpload.restoredFromReload &&
            currentStage ===
                requiredTotal - 1 &&
            otherUploader
        ) {

            console.log(
                `[IVAC RESTORE] ${slot.title} final pending → RETRY SAME`
            );


            setStatus(
                `${slot.title} RESTORED PENDING → RETRY SAME`,
                '#cc7900'
            );


            waitingUpload =
                null;


            persistRuntimeState();


            return true;
        }


        /***********************************************************
         * RULE 3 — COUNT এখনও update হয়নি, কিন্তু NEXT BUTTON READY
         * এবং কোনো নতুন error নেই।
         *
         * Server count update slow হলেও next upload button পাওয়া মানে
         * current upload flow next stage-এর জন্য ready।
         *
         * PRIMARY: OTHER button visible হলেই next ready.
         * OTHER: button disappear->reappear অথবা input replace হলে ready.
         ***********************************************************/

        const nextButtonReady =
            Boolean(otherUploader) &&
            (
                currentStage === 0 ||
                waitingUpload
                    .sawOtherButtonMissing ||
                otherUploader.input !==
                    waitingUpload.input
            );


        if (
            currentStage <
                requiredTotal - 1 &&
            nextButtonReady
        ) {

            console.log(
                `[IVAC SUCCESS] ${slot.title} COMPLETE ✓`,
                '| NEXT UPLOAD BUTTON READY',
                '| COUNT:',
                total === null ? '?' : total,
                '(count may still be updating)'
            );


            stage =
                currentStage + 1;

            waitingUpload =
                null;


            persistRuntimeState();


            setStatus(
                `${slot.title} COMPLETE ✓ → NEXT`,
                '#07883c'
            );


            return true;
        }


        /***********************************************************
         * LAST FILE
         *
         * Last file-এর পরে আর OTHER button নেই।
         * তাই requiredTotal count না হওয়া পর্যন্ত Confirm হবে না।
         * Error এলে উপরের RULE 2 same file retry করবে।
         ***********************************************************/

        if (
            currentStage ===
                requiredTotal - 1
        ) {

            setStatus(
                `${slot.title} SENT - WAIT COUNT ${total === null ? '?' : total}/${requiredTotal}`,
                '#1464c0'
            );


            return false;
        }


        /***********************************************************
         * Still waiting for next upload button / count / error
         ***********************************************************/

        setStatus(
            `${slot.title} SENT - WAIT NEXT`,
            '#1464c0'
        );


        return false;
    }


    /***************************************************************
     * TOP PANEL
     ***************************************************************/

    const panel =
        document.createElement(
            'div'
        );


    panel.id =
        'ivac-auto-panel';


    Object.assign(
        panel.style,
        {

            position:
                'fixed',

            top:
                '100px',

            right:
                '7px',

            zIndex:
                '2147483647',

            display:
                'flex',

            alignItems:
                'center',

            gap:
                '6px',

            padding:
                '7px',

            background:
                '#fff',

            border:
                '2px solid #111',

            borderRadius:
                '10px',

            boxShadow:
                '0 4px 16px rgba(0,0,0,.35)',

            fontFamily:
                'Arial,sans-serif',

            userSelect:
                'none'
        }
    );


    /***************************************************************
     * DRAGGABLE PANEL
     ***************************************************************/

    let isDraggingPanel = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panelStartLeft = 0;
    let panelStartTop = 0;


    panel.addEventListener(
        'pointerdown',
        event => {

            if (
                event.target.closest(
                    'button, input, select'
                )
            ) {
                return;
            }


            const rect =
                panel.getBoundingClientRect();


            isDraggingPanel = true;

            dragStartX =
                event.clientX;

            dragStartY =
                event.clientY;

            panelStartLeft =
                rect.left;

            panelStartTop =
                rect.top;


            panel.style.left =
                rect.left + 'px';

            panel.style.top =
                rect.top + 'px';

            panel.style.right =
                'auto';


            panel.setPointerCapture?.(
                event.pointerId
            );


            event.preventDefault();
        }
    );


    panel.addEventListener(
        'pointermove',
        event => {

            if (!isDraggingPanel) {
                return;
            }


            const nextLeft =
                panelStartLeft +
                (
                    event.clientX -
                    dragStartX
                );


            const nextTop =
                panelStartTop +
                (
                    event.clientY -
                    dragStartY
                );


            const maxLeft =
                Math.max(
                    0,
                    window.innerWidth -
                    panel.offsetWidth
                );


            const maxTop =
                Math.max(
                    0,
                    window.innerHeight -
                    panel.offsetHeight
                );


            panel.style.left =
                Math.min(
                    Math.max(
                        0,
                        nextLeft
                    ),
                    maxLeft
                ) + 'px';


            panel.style.top =
                Math.min(
                    Math.max(
                        0,
                        nextTop
                    ),
                    maxTop
                ) + 'px';
        }
    );


    panel.addEventListener(
        'pointerup',
        event => {

            isDraggingPanel = false;


            panel.releasePointerCapture?.(
                event.pointerId
            );
        }
    );


    panel.addEventListener(
        'pointercancel',
        () => {

            isDraggingPanel = false;
        }
    );


    /***************************************************************
     * AUTO BUTTON
     ***************************************************************/

    const toggle =
        document.createElement(
            'button'
        );


    Object.assign(
        toggle.style,
        {

            border:
                'none',

            color:
                '#fff',

            padding:
                '8px 12px',

            borderRadius:
                '7px',

            fontSize:
                '12px',

            fontWeight:
                '700',

                width:
            '50%',

            cursor:
                'pointer'
        }
    );


    function updateToggle() {

        if (autoEnabled) {

            toggle.textContent =
                'Auto Upload: ON';

            toggle.style.background =
                '#07883c';

        } else {

            toggle.textContent =
                'Auto Upload: OFF';

            toggle.style.background =
                '#d62828';
        }
    }


    /***************************************************************
     * UPLOAD COUNT
     *
     * Default = 4.
     * User can save 1, 2, 3 or 4 from the panel.
     * Four file slots always remain available; automation only uses
     * the first requiredTotal files.
     ***************************************************************/

    const countLabel =
        document.createElement(
            'span'
        );


    countLabel.textContent =
        'UPLOAD:';


    Object.assign(
        countLabel.style,
        {
            fontSize:
                '10px',

            fontWeight:
                '700',

            color:
                '#111'
        }
    );


    const countSelect =
        document.createElement(
            'select'
        );


    [1, 2, 3, 4].forEach(
        number => {

            const option =
                document.createElement(
                    'option'
                );


            option.value =
                String(number);

            option.textContent =
                String(number);


            countSelect.appendChild(
                option
            );
        }
    );


    countSelect.value =
        String(requiredTotal);


    Object.assign(
        countSelect.style,
        {
            height:
                '30px',

            minWidth:
                '44px',

            border:
                '1px solid #777',

            borderRadius:
                '6px',

            background:
                '#fff',

            fontSize:
                '12px',

            fontWeight:
                '700',

            cursor:
                'pointer'
        }
    );


    const countSaveButton =
        document.createElement(
            'button'
        );


    countSaveButton.textContent =
        'SAVE';


    Object.assign(
        countSaveButton.style,
        {
            border:
                'none',

            background:
                '#1464c0',

            color:
                '#fff',

            padding:
                '8px 9px',

            borderRadius:
                '7px',

            fontSize:
                '10px',

            fontWeight:
                '700',

            cursor:
                'pointer'
        }
    );


    countSaveButton.onclick =
        () => {

            requiredTotal =
                clampRequiredTotal(
                    countSelect.value
                );


            countSelect.value =
                String(requiredTotal);


            GM_setValue(
                'IVAC_REQUIRED_TOTAL',
                requiredTotal
            );


            waitingUpload =
                null;

            restoredPendingState =
                null;

            confirmClicked =
                false;


            const total =
                getTotalApplicants();


            if (
                total !== null
            ) {

                stage =
                    Math.min(
                        total,
                        requiredTotal
                    );
            } else if (
                stage > requiredTotal
            ) {

                stage =
                    requiredTotal;
            }


            persistRuntimeState();


            setStatus(
                `UPLOAD COUNT SAVED: ${requiredTotal}`,
                '#07883c'
            );


            console.log(
                '[IVAC UPLOAD COUNT]',
                requiredTotal
            );


            if (autoEnabled) {
                runAutomation();
            }
        };


    /***************************************************************
     * STATUS
     ***************************************************************/

    const status =
        document.createElement(
            'span'
        );


    Object.assign(
        status.style,
        {

            minWidth:
                '150px',

            maxWidth:
                '240px',

            fontSize:
                '10px',

            fontWeight:
                '700',

            whiteSpace:
                'nowrap',

            color:
                '#555'
        }
    );


    function setStatus(
        text,
        color = '#555'
    ) {

        status.textContent =
            text;

        status.style.color =
            color;
    }


    /***************************************************************
     * FILE SETUP WINDOW
     ***************************************************************/

    const setup =
        document.createElement(
            'div'
        );


    setup.id =
        'ivac-file-setup-window';


    Object.assign(
        setup.style,
        {

            position:
                'fixed',

            top:
                '55px',

            right:
                '7px',

            zIndex:
                '2147483647',

            display:
                'none',

            width:
                '370px',

            padding:
                '12px',

            background:
                '#fff',

            border:
                '2px solid #111',

            borderRadius:
                '10px',

            boxShadow:
                '0 4px 16px rgba(0,0,0,.35)',

            fontFamily:
                'Arial,sans-serif'
        }
    );


    const setupTitle =
        document.createElement(
            'div'
        );


    setupTitle.textContent =
        'SET 4 APPLICANT WEBFILES';


    Object.assign(
        setupTitle.style,
        {

            fontWeight:
                '700',

            fontSize:
                '13px',

            marginBottom:
                '10px'
        }
    );



    /***************************************************************
     * FILE PICKER
     ***************************************************************/

    const picker =
        document.createElement(
            'input'
        );


    picker.id =
        'ivac-file-setup-picker';


    picker.type =
        'file';


    picker.accept =
        '.pdf,application/pdf';


    picker.style.display =
        'none';


    document.body.appendChild(
        picker
    );


    let pickerIndex =
        null;


    const fileNameLabels =
        [];


    FILES.forEach(
        (slot, index) => {

            const row =
                document.createElement(
                    'div'
                );


            Object.assign(
                row.style,
                {

                    display:
                        'flex',

                    alignItems:
                        'center',

                    gap:
                        '7px',

                    marginBottom:
                        '7px'
                }
            );


            const button =
                document.createElement(
                    'button'
                );


            button.textContent =
                `${slot.title}`;


            Object.assign(
                button.style,
                {

                    width:
                        '80px',

                    border:
                        'none',

                    padding:
                        '7px',

                    background:
                        '#004638',

                    color:
                        '#fff',

                    borderRadius:
                        '6px',

                    fontSize:
                        '11px',

                    fontWeight:
                        '700',

                    cursor:
                        'pointer'
                }
            );


            const name =
                document.createElement(
                    'span'
                );


            name.textContent =
                'Not set';


                       Object.assign(
                name.style,
                {

                    flex:
                        '1',

                    overflow:
                        'hidden',

                    textOverflow:
                        'ellipsis',

                    whiteSpace:
                        'nowrap',

                    fontSize:
                        '12px',

                    textAlign:
                        'left'
                }
            );

            button.onclick =
                () => {

                    pickerIndex =
                        index;

                    picker.value =
                        '';

                    picker.click();
                };


            row.appendChild(
                button
            );


            row.appendChild(
                name
            );


            setup.appendChild(
                row
            );


            fileNameLabels.push(
                name
            );
        }
    );

        /***************************************************************
     * PDF LABEL — নাম ও বাকি দিন (PRIMARY / OTHER 1-3 এর পাশে দেখাবে)
     ***************************************************************/

    async function inflateBytes(bytes) {
        const stream = new Blob([bytes])
            .stream()
            .pipeThrough(new DecompressionStream('deflate'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    async function extractPdfTokens(buffer) {
        const bytes = new Uint8Array(buffer);
        const raw = new TextDecoder('latin1').decode(bytes);
        const tokens = [];
        const streamRe = /(?<!end)stream\r?\n/g;
        let m;

        while ((m = streamRe.exec(raw))) {
            const start = m.index + m[0].length;
            const endstreamAt = raw.indexOf('endstream', start);
            if (endstreamAt < 0) continue;

            let end = endstreamAt;
            const dict = raw.slice(Math.max(0, m.index - 400), m.index);
            const lenRe = /\/Length\s+(\d+)(?!\s+\d+\s+R)/g;
            let lm, lastLen = null;
            while ((lm = lenRe.exec(dict))) lastLen = Number(lm[1]);
            if (lastLen !== null && start + lastLen <= endstreamAt) {
                end = start + lastLen;
            } else {
                while (end > start && /[\r\n ]/.test(raw[end - 1])) end--;
            }

            let text;
            try {
                text = new TextDecoder('latin1').decode(await inflateBytes(bytes.subarray(start, end)));
            } catch (e) {
                text = raw.slice(start, end);
            }

            const strRe = /\(((?:\\.|[^\\()])*)\)/g;
            let s;
            while ((s = strRe.exec(text))) {
                const value = s[1].replace(/\\(.)/g, '$1').trim();
                if (value) tokens.push(value);
            }
        }
        return tokens;
    }

    function findValueAfter(tokens, label, ahead) {
        ahead = ahead || 4;
        const L = label.toLowerCase();
        const i = tokens.findIndex(t => t.toLowerCase().includes(L));
        if (i < 0) return '';
        for (let j = i + 1; j <= i + ahead && j < tokens.length; j++) {
            const t = tokens[j];
            if (t.length > 1 && !/[()]/.test(t) && !/:$/.test(t)) return t;
        }
        return '';
    }

    function findDateNear(tokens, label) {
        const L = label.toLowerCase();
        const i = tokens.findIndex(t => t.toLowerCase().includes(L));
        if (i < 0) return null;
        for (let j = i; j <= i + 5 && j < tokens.length; j++) {
            const m = /(\d{2})-([A-Z]{3})-(\d{4})/i.exec(tokens[j]);
            if (m) return m[0].toUpperCase();
        }
        return null;
    }

    const LBL_MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

    function slotLabelFromTokens(tokens) {
        const given = findValueAfter(tokens, 'Given Name');
        const surname = findValueAfter(tokens, 'Surname');
        const name = [given, surname].filter(Boolean).join(' ');

        const regText = findDateNear(tokens, 'Registration Date') || '';
        const m = /(\d{2})-([A-Z]{3})-(\d{4})/i.exec(regText);
        const month = m ? LBL_MONTHS[m[2].toUpperCase()] : undefined;
        if (!m || month === undefined) return name || null;

        const reg = new Date(Number(m[3]), month, Number(m[1]));
        const deadline = new Date(reg.getFullYear(), reg.getMonth(), reg.getDate() + 29);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const left = Math.round((deadline - today) / 86400000);

        //const dayText = left >= 0 ? `${left}` : 'Expired';
        return name ? `${name}` : dayText;
    }

    async function slotLabelFromRecord(record) {
        try {
            const tokens = await extractPdfTokens(record.data);
            return slotLabelFromTokens(tokens) || record.name;
        } catch (e) {
            return record.name;
        }
    }



    /***************************************************************
     * REFRESH FILE LIST
     ***************************************************************/

    async function refreshFiles() {

        for (
            let i = 0;
            i < FILES.length;
            i++
        ) {

            try {

                const record =
                    await getSavedRecord(
                        FILES[i].key
                    );


                if (record) {

                                        fileNameLabels[i].textContent =
                        await slotLabelFromRecord(record);

                    fileNameLabels[i].style.fontSize = '12px';
                    fileNameLabels[i].style.fontWeight = '700';
                    fileNameLabels[i].style.textAlign = 'left';



                    fileNameLabels[i]
                        .style.color =
                        '#07883c';

                } else {

                    fileNameLabels[i]
                        .textContent =
                        'Not set';


                    fileNameLabels[i]
                        .style.color =
                        '#d62828';
                }

            } catch {

                fileNameLabels[i]
                    .textContent =
                    'Not set';
            }
        }
    }


    /***************************************************************
     * AUTO UPLOAD COUNT
     *
     * Upload count = number of file slots that currently have a file.
     * Set/change a file ➜ count updates automatically (no SAVE button).
     ***************************************************************/

    async function syncRequiredTotal(resetState) {

        let filled = 0;

        for (const slot of FILES) {

            try {

                const record =
                    await getSavedRecord(
                        slot.key
                    );

                if (record) {
                    filled++;
                }

            } catch {}
        }

        const newTotal =
            Math.min(
                4,
                Math.max(1, filled)
            );

        countSelect.value =
            String(newTotal);

        if (newTotal === requiredTotal) {
            return;
        }

        requiredTotal =
            newTotal;

        GM_setValue(
            'IVAC_REQUIRED_TOTAL',
            requiredTotal
        );

        if (resetState) {

            waitingUpload =
                null;

            restoredPendingState =
                null;

            confirmClicked =
                false;
        }

        persistRuntimeState();

        setStatus(
            `UPLOAD COUNT AUTO: ${requiredTotal}`,
            '#07883c'
        );

        console.log(
            '[IVAC UPLOAD COUNT AUTO]',
            requiredTotal
        );

        if (autoEnabled) {
            runAutomation();
        }
    }


    /***************************************************************
     * SAVE SELECTED FILE
     ***************************************************************/

    picker.addEventListener(
        'change',
        async () => {

            if (
                pickerIndex === null
            ) {
                return;
            }


            const file =
                picker.files?.[0];


            if (!file) {
                return;
            }


            const result =
                validateFile(
                    file
                );


            if (!result.ok) {

                if (
                    result.reason ===
                    '>500KB'
                ) {

                    alert(
                        file.name +
                        '\n\nFile size: ' +
                        Math.round(
                            file.size /
                            1024
                        ) +
                        ' KB\nMaximum: 500KB'
                    );

                } else {

                    alert(
                        'Only PDF file is allowed.'
                    );
                }


                return;
            }


            await saveFile(
                FILES[pickerIndex].key,
                file
            );

                         document.dispatchEvent(new CustomEvent('ivac-files-changed', {
                detail: { source: 'adjust' }
            }));

            setStatus(
                `${FILES[pickerIndex].title} SAVED ✓`,
                '#07883c'
            );


            console.log(
                '[IVAC FILE SAVED]',
                FILES[pickerIndex].title,
                file.name
            );


            await refreshFiles();

            await syncRequiredTotal(true);
        }
    );


    /***************************************************************
     * FILE WINDOW
     ***************************************************************/

    /***************************************************************
     * ADD UI
     ***************************************************************/

    // Top row: AUTO, UPLOAD count, SAVE, status
    const topRow =
        document.createElement(
            'div'
        );

    Object.assign(
        topRow.style,
        {
            display:
                'flex',

            alignItems:
                'center',

            gap:
                '6px'
        }
    );

    topRow.appendChild(toggle);

    // FILE SETUP is embedded below the top row and always visible.
    setup.style.display = 'block';
    setup.style.position = 'static';
    setup.style.top = '';
    setup.style.right = '';
    setup.style.left = '';
    setup.style.zIndex = '';
    setup.style.boxShadow = 'none';
    setup.style.border = '1px solid #ddd';
    setup.style.borderRadius = '8px';
    setup.style.boxSizing = 'border-box';
    setup.style.marginTop = '2px';

    panel.style.flexDirection = 'column';
    panel.style.alignItems = 'stretch';

    // Status moved to its own row below the top controls.
    status.style.display = 'block';
    status.style.width = '100%';
    status.style.boxSizing = 'border-box';
    status.style.padding = '4px 6px';
    status.style.borderRadius = '6px';
    status.style.background = '#f6f6f6';
    status.style.textAlign = 'left';

    panel.appendChild(topRow);
    panel.appendChild(status);
    panel.appendChild(setup);

    topRow.style.order = '1';
status.style.order = '2';
setup.style.order = '3';

    document.body.appendChild(panel);

    // Fixed panel width: 300px (UI only)
    panel.style.width = '300px';
    panel.style.boxSizing = 'border-box';
    setup.style.width = '100%';


        /***************************************************************
     * MASTER CONTROL — 3টা auto button একটা দিয়ে control
     ***************************************************************/

    const MASTER_LABELS = [
        'Auto Upload:',
        'Auto Reserve:',
        'Auto Initiate:'
    ];

    function getMasterTargets() {

        const buttons =
            Array.from(document.querySelectorAll('button'));

        return MASTER_LABELS
            .map(label =>
                buttons.find(btn =>
                    btn.textContent.includes(label)
                )
            )
            .filter(Boolean);
    }

    function isMasterTargetOn(btn) {
        return /:\s*ON/i.test(btn.textContent);
    }

    function isAllAutoOn() {

        const targets = getMasterTargets();

        return (
            targets.length === MASTER_LABELS.length &&
            targets.every(isMasterTargetOn)
        );
    }

    const masterButton =
        document.createElement('button');

    masterButton.id = 'ivac-master-toggle';

    Object.assign(masterButton.style, {
        width: '100%',
        border: 'none',
        color: '#fff',
        padding: '9px 12px',
        borderRadius: '7px',
        fontSize: '13px',
        fontWeight: '700',
        cursor: 'pointer',
        marginBottom: '4px',
        boxSizing: 'border-box'
    });

    function updateMasterUI() {

        const on = isAllAutoOn();

        masterButton.textContent =
            on ? 'ALL AUTO: ON' : 'ALL AUTO: OFF';

        masterButton.style.background =
            on ? '#07883c' : '#d62828';
    }

    masterButton.onclick = () => {

        const targets = getMasterTargets();

        if (targets.length !== MASTER_LABELS.length) {
            setStatus(
                'Panel not ready, try again',
                '#cc7900'
            );
            return;
        }

        const allOn = isAllAutoOn();

        targets.forEach(btn => {

            const isOn = isMasterTargetOn(btn);

            // সব ON থাকলে সবগুলো OFF,
            // না হলে যেগুলো OFF সেগুলো ON
            if (allOn ? isOn : !isOn) {
                btn.click();
            }
        });

        setTimeout(updateMasterUI, 150);
        setTimeout(updateMasterUI, 700);
    };

        // ALL AUTO বাটন Auto Upload-এর পাশের সারিতে
    masterButton.style.width = 'auto';
    masterButton.style.flex = '1';
    masterButton.style.marginBottom = '0';
    masterButton.style.padding = '8px 10px';
    masterButton.style.fontSize = '12px';
    topRow.appendChild(masterButton);

    // বাকি দুই panel-এর state change হলে master বাটনও update হবে
    setInterval(updateMasterUI, 1000);
    updateMasterUI();


    // =================================================================
    // IVAC DATE AUTO PANEL (embedded, functions unchanged)
    // =================================================================
    (function () {
        'use strict';


        // ============================================================
        // IVAC PAGE CHECK
        // Panel can show everywhere, but automation ONLY runs on IVAC.
        // ============================================================

        function isIVACPage() {
            try {
                return location.hostname === 'appointment.ivacbd.com';
            } catch (e) {
                return false;
            }
        }


        function isTimeSlotPage() {
            try {
                const path = location.pathname.replace(/\/+$/, '') || '/';
                return (
                    location.hostname === 'appointment.ivacbd.com' &&
                    path === DATE_PAGE_PATH
                );
            } catch (e) {
                return false;
            }
        }

        // ============================================================
        // DEFAULT SETTINGS
        // ============================================================

        const DEFAULT_MIN_SECONDS = 20;
        const DEFAULT_MAX_SECONDS = 22;

        const WATCH_INTERVAL = 1000; // waiting for available date: check once per second
        const AFTER_DATE_CLICK = 500;

        const DEFAULT_CONTINUE_WAIT_SECONDS = 180; // 3 minutes
        const CONTINUE_CHECK_INTERVAL = 1000; // check every 1 second

        const PAGE_LEAVE_DELAY = 1500;

        const DATE_PAGE_PATH = '/appointment/time-slot';


        // ============================================================
        // STORAGE KEYS
        // ============================================================

        const KEY_ENABLED = 'ivac_date_auto_enabled';
        const KEY_MIN_SECONDS = 'ivac_date_auto_min_seconds';
        const KEY_MAX_SECONDS = 'ivac_date_auto_max_seconds';
        const KEY_DATE_MODE = 'ivac_date_auto_mode';
        const KEY_CONTINUE_WAIT_SECONDS = 'ivac_date_auto_continue_wait_seconds';


        // ============================================================
        // SAFE STORAGE
        // Logic unchanged; this only prevents storage errors from
        // stopping the whole script on blank/restricted pages.
        // ============================================================

        const memoryStorage = {};

        function safeGetItem(key) {
            try {
                return localStorage.getItem(key);
            } catch (e) {
                return Object.prototype.hasOwnProperty.call(memoryStorage, key)
                    ? memoryStorage[key]
                    : null;
            }
        }

        function safeSetItem(key, value) {
            try {
                localStorage.setItem(key, String(value));
            } catch (e) {
                memoryStorage[key] = String(value);
            }
        }


        // ============================================================
        // STATE
        // ============================================================

        let automationEnabled =
            safeGetItem(KEY_ENABLED) === 'true';

        let minSeconds =
            Number(safeGetItem(KEY_MIN_SECONDS)) ||
            DEFAULT_MIN_SECONDS;

        let maxSeconds =
            Number(safeGetItem(KEY_MAX_SECONDS)) ||
            DEFAULT_MAX_SECONDS;

        const savedContinueWaitSeconds =
            Number(safeGetItem(KEY_CONTINUE_WAIT_SECONDS));
        let continueWaitSeconds =
            Number.isFinite(savedContinueWaitSeconds) && savedContinueWaitSeconds >= 1
                ? savedContinueWaitSeconds
                : DEFAULT_CONTINUE_WAIT_SECONDS;

        const savedDateMode = safeGetItem(KEY_DATE_MODE);
        let dateMode =
            ['1-M', 'M+1', 'MR', 'FL', 'LF'].includes(savedDateMode)
                ? savedDateMode
                : 'MR';

        let datePageActive = false;
        let firstCycleDone = false;

        let cycleRunning = false;
        let lastSelectedDate = null;

        // Ordered date sequence depends on selected mode:
        // M+1 = Middle -> ... -> Last -> Middle-1 -> ... -> First
        // 1-M = Middle -> ... -> First -> Middle+1 -> ... -> Last
        // MR  = Middle first -> all other available dates in random order
        // FL  = First available -> ... -> Last available
        // LF  = Last available -> ... -> First available
        // Store date values only, never long-lived DOM button references.
        let dateSequence = [];
        let dateSequenceIndex = 0;

        let nextCycleTimer = null;
        let pageLeaveTimer = null;

        let statusElement = null;
        let toggleButton = null;
        let modeButtons = {};
        let minInput = null;
        let maxInput = null;
        let countdownInterval = null;
        let scriptStarted = false;


        // ============================================================
        // LOG
        // ============================================================

        function log(...args) {

            console.log(
                '%c[IVAC AUTO]',
                'background:#FF671F;color:#fff;padding:3px 7px;border-radius:4px;font-weight:bold;',
                ...args
            );
        }


        // ============================================================
        // SLEEP
        // ============================================================

        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }


        // ============================================================
        // RANDOM INTERVAL
        // ============================================================

        function getRandomDelay() {

            let min = Number(minSeconds);
            let max = Number(maxSeconds);

            if (!Number.isFinite(min) || min < 1) {
                min = DEFAULT_MIN_SECONDS;
            }

            if (!Number.isFinite(max) || max < 1) {
                max = DEFAULT_MAX_SECONDS;
            }

            if (min > max) {
                [min, max] = [max, min];
            }

            // Random whole second between min and max inclusive
            const seconds =
                Math.floor(
                    Math.random() * (max - min + 1)
                ) + min;

            return seconds * 1000;
        }


        // ============================================================
        // AVAILABLE DATE BUTTONS
        // ============================================================

        function getAvailableDates() {

            // Heavy calendar-button scan is allowed only on the exact time-slot page.
            if (!isTimeSlotPage()) {
                return [];
            }

            return Array.from(
                document.querySelectorAll('button')
            )
                .filter(button => {

                    const text =
                        button.textContent.trim();

                    // Date number 1 - 31
                    if (
                        !/^(?:[1-9]|[12][0-9]|3[01])$/.test(text)
                    ) {
                        return false;
                    }

                    // Disabled = unavailable
                    if (button.disabled) {
                        return false;
                    }

                    const cls =
                        String(button.className || '');

                    // Match calendar date button
                    if (
                        !cls.includes('w-9') ||
                        !cls.includes('h-9') ||
                        !cls.includes('rounded-full')
                    ) {
                        return false;
                    }

                    const rect =
                        button.getBoundingClientRect();

                    return (
                        rect.width > 0 &&
                        rect.height > 0
                    );
                })
                .sort(
                    (a, b) =>
                        Number(a.textContent.trim()) -
                        Number(b.textContent.trim())
                );
        }


        // ============================================================
        // CONTINUE BOOKING BUTTON
        // ============================================================

        function getContinueButton() {

            return Array.from(
                document.querySelectorAll('button')
            ).find(button => {

                const text =
                    button.textContent
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();

                return text.includes('continue booking');

            }) || null;
        }


        function isContinueReady(button) {

            if (!button) {
                return false;
            }

            if (button.disabled) {
                return false;
            }

            if (
                button.getAttribute('aria-disabled') === 'true'
            ) {
                return false;
            }

            const rect =
                button.getBoundingClientRect();

            return (
                rect.width > 0 &&
                rect.height > 0
            );
        }


        async function waitForContinueButton() {

            const started = Date.now();

            while (
                Date.now() - started <
                continueWaitSeconds * 1000
            ) {

                if (!automationEnabled) {
                    return null;
                }

                const button =
                    getContinueButton();

                if (isContinueReady(button)) {
                    return button;
                }

                await sleep(
                    CONTINUE_CHECK_INTERVAL
                );
            }

            return null;
        }


        // ============================================================
        // MIDDLE DATE
        // ============================================================

        function chooseMiddleDate(buttons) {

            if (!buttons.length) {
                return null;
            }

            if (buttons.length === 1) {
                return buttons[0];
            }

            /*
                5 dates:
                13 14 15 16 17
                      ^
                     15

                4 dates:
                13 14 15 16
                   ^
                  14

                Even হলে left-middle নেওয়া হবে।
            */

            const middleIndex =
                Math.floor(
                    (buttons.length - 1) / 2
                );

            return buttons[middleIndex];
        }


        // ============================================================
        // ORDERED DATE SEQUENCE / 5 MODES
        // ============================================================

        function resetDateSequence() {

            dateSequence = [];
            dateSequenceIndex = 0;
        }


        function shuffleValues(values) {

            const shuffled = [...values];

            for (let i = shuffled.length - 1; i > 0; i--) {

                const j =
                    Math.floor(
                        Math.random() * (i + 1)
                    );

                [shuffled[i], shuffled[j]] =
                    [shuffled[j], shuffled[i]];
            }

            return shuffled;
        }


        function buildFreshDateSequence(buttons) {

            resetDateSequence();

            if (!buttons.length) {
                return false;
            }

            const values =
                buttons.map(button =>
                    button.textContent.trim()
                );

            // Keep the existing middle-date rule exactly as-is.
            const middleButton =
                chooseMiddleDate(buttons);

            if (!middleButton) {
                return false;
            }

            const middleValue =
                middleButton.textContent.trim();

            const middleIndex =
                values.indexOf(middleValue);

            if (middleIndex < 0) {
                return false;
            }

            const leftSide =
                values.slice(0, middleIndex);

            const rightSide =
                values.slice(middleIndex + 1);

            if (dateMode === '1-M') {

                // Middle -> Middle-1 ... First -> Middle+1 ... Last
                dateSequence = [
                    values[middleIndex],
                    ...leftSide.reverse(),
                    ...rightSide
                ];

            } else if (dateMode === 'M+1') {

                // Middle -> Middle+1 ... Last -> Middle-1 ... First
                dateSequence = [
                    values[middleIndex],
                    ...rightSide,
                    ...leftSide.reverse()
                ];

            } else if (dateMode === 'FL') {

                // FL: First available -> ... -> Last available
                dateSequence = [
                    ...values
                ];

            } else if (dateMode === 'LF') {

                // LF: Last available -> ... -> First available
                dateSequence = [
                    ...values
                ].reverse();

            } else {

                // MR: Middle first, then every other available date randomly.
                const remaining =
                    values.filter(
                        (_, index) => index !== middleIndex
                    );

                dateSequence = [
                    values[middleIndex],
                    ...shuffleValues(remaining)
                ];
            }

            dateSequenceIndex = 0;

            log(
                `FRESH DATE SEQUENCE [${dateMode}]:`,
                dateSequence.join(' -> ')
            );

            return true;
        }


        function getNextSequenceTarget() {

            // At most two passes are needed:
            // 1) finish/skip the current stored sequence
            // 2) fresh-scan and start the next sequence
            for (let pass = 0; pass < 2; pass++) {

                if (
                    !dateSequence.length ||
                    dateSequenceIndex >= dateSequence.length
                ) {

                    const freshDates =
                        getAvailableDates();

                    if (!freshDates.length) {
                        resetDateSequence();
                        return null;
                    }

                    if (!buildFreshDateSequence(freshDates)) {
                        return null;
                    }
                }

                while (
                    dateSequenceIndex <
                    dateSequence.length
                ) {

                    const dateValue =
                        dateSequence[dateSequenceIndex];

                    // Fresh DOM lookup for every turn.
                    const currentDates =
                        getAvailableDates();

                    const button =
                        currentDates.find(currentButton =>
                            currentButton.textContent.trim() ===
                            String(dateValue)
                        ) || null;

                    if (button) {

                        return {
                            button,
                            dateValue,
                            index: dateSequenceIndex,
                            total: dateSequence.length
                        };
                    }

                    // Date disappeared before its turn: skip it.
                    log(
                        'SKIP UNAVAILABLE DATE:',
                        dateValue
                    );

                    dateSequenceIndex++;
                }
            }

            return null;
        }


        // ============================================================
        // SELECT DATE
        // ============================================================

        async function selectDate(button) {

            if (
                !button ||
                !automationEnabled ||
                !document.contains(button)
            ) {
                return false;
            }

            const date =
                button.textContent.trim();

            log('Selecting date:', date);

            updateStatus(
                `Selecting date ${date}...`
            );

            try {

                button.scrollIntoView({
                    block: 'center',
                    inline: 'center'
                });

            } catch (e) {}

            // Click immediately
            button.click();

            lastSelectedDate = date;

            return true;
        }


        // ============================================================
        // CLICK CONTINUE BOOKING
        // ============================================================

        async function clickContinueBooking() {

            if (!automationEnabled) {
                return false;
            }

            updateStatus(
                'Waiting for Continue...'
            );

            const button =
                await waitForContinueButton();

            if (
                !button ||
                !automationEnabled
            ) {

                updateStatus(
                    automationEnabled
                        ? 'Continue not ready'
                        : 'OFF'
                );

                return false;
            }

            if (!isContinueReady(button)) {
                return false;
            }

            log('Clicking Continue Booking');

            updateStatus(
                'Clicking Continue...'
            );

            button.click();

            return true;
        }


        // ============================================================
        // MAIN CYCLE
        // ============================================================

        async function runCycle(firstCycle = false) {

            if (!automationEnabled) {
                return;
            }

            if (!datePageActive) {
                return;
            }

            if (cycleRunning) {
                return;
            }

            cycleRunning = true;

            // null = Continue stage was not reached yet
            // true = Continue clicked successfully
            // false = Continue was not ready within timeout / click could not happen
            let continueClicked = null;

            try {

                const availableDates =
                    getAvailableDates();

                if (!availableDates.length) {

                    updateStatus(
                        'No available date'
                    );

                    return;
                }


                log(
                    'Available:',
                    availableDates
                        .map(btn =>
                            btn.textContent.trim()
                        )
                        .join(', ')
                );


                const targetInfo =
                    getNextSequenceTarget();


                if (!targetInfo) {

                    updateStatus(
                        'No available date'
                    );

                    return;
                }


                const target =
                    targetInfo.button;


                if (targetInfo.index === 0) {

                    if (dateMode === 'FL') {

                        log(
                            'FIRST:',
                            targetInfo.dateValue
                        );

                        updateStatus(
                            `First: ${targetInfo.dateValue}`
                        );

                    } else if (dateMode === 'LF') {

                        log(
                            'LAST:',
                            targetInfo.dateValue
                        );

                        updateStatus(
                            `Last: ${targetInfo.dateValue}`
                        );

                    } else {

                        log(
                            'MIDDLE:',
                            targetInfo.dateValue
                        );

                        updateStatus(
                            `Middle: ${targetInfo.dateValue}`
                        );
                    }

                } else {

                    log(
                        'NEXT DATE:',
                        targetInfo.dateValue,
                        `(${targetInfo.index + 1}/${targetInfo.total})`
                    );

                    updateStatus(
                        `Next date: ${targetInfo.dateValue}`
                    );
                }


                if (!automationEnabled) {
                    return;
                }


                const clicked =
                    await selectDate(target);


                if (!clicked) {
                    return;
                }


                // Advance only after a real date click succeeds.
                dateSequenceIndex++;


                // First cycle is now complete
                if (firstCycle) {
                    firstCycleDone = true;
                }


                await sleep(
                    AFTER_DATE_CLICK
                );


                if (!automationEnabled) {
                    return;
                }


                continueClicked =
                    await clickContinueBooking();


            } catch (error) {

                console.error(
                    '[IVAC AUTO ERROR]',
                    error
                );

                updateStatus('Error');

            } finally {

                cycleRunning = false;

                if (
                    automationEnabled &&
                    datePageActive
                ) {

                    // Continue was NOT found/clicked within the configured wait window:
                    // skip the normal 20-22 second interval and try the next date immediately.
                    if (continueClicked === false) {

                        log(
                            'Continue timeout -> next date immediately'
                        );

                        updateStatus(
                            'Continue timeout → next date'
                        );

                        clearNextTimer();

                        nextCycleTimer =
                            setTimeout(
                                () => {

                                    nextCycleTimer = null;

                                    if (
                                        automationEnabled &&
                                        datePageActive
                                    ) {

                                        runCycle(false);
                                    }
                                },
                                0
                            );

                    } else {

                        // Continue clicked successfully (or Continue stage was not reached):
                        // keep the original 20-22 second interval logic unchanged.
                        scheduleNextCycle();
                    }
                }
            }
        }


        // ============================================================
        // NEXT CYCLE
        // ============================================================

        function scheduleNextCycle() {

            clearNextTimer();

            if (
                !automationEnabled ||
                !datePageActive
            ) {
                return;
            }

            const delay =
                getRandomDelay();

            const seconds =
                delay / 1000;

            log(
                `Next date in ${seconds} seconds`
            );

            startCountdown(seconds);

            nextCycleTimer =
                setTimeout(
                    () => {

                        stopCountdown();

                        if (
                            automationEnabled &&
                            datePageActive
                        ) {

                            runCycle(false);
                        }

                    },
                    delay
                );
        }


        function clearNextTimer() {

            if (nextCycleTimer) {

                clearTimeout(nextCycleTimer);

                nextCycleTimer = null;
            }

            stopCountdown();
        }


        // ============================================================
        // COUNTDOWN
        // ============================================================

        function startCountdown(seconds) {

            stopCountdown();

            let remaining = seconds;

            updateStatus(
                `Next in ${remaining}s`
            );

            countdownInterval =
                setInterval(
                    () => {

                        remaining--;

                        if (remaining <= 0) {

                            stopCountdown();

                            updateStatus(
                                'Running...'
                            );

                            return;
                        }

                        updateStatus(
                            `Next in ${remaining}s`
                        );

                    },
                    1000
                );
        }


        function stopCountdown() {

            if (countdownInterval) {

                clearInterval(
                    countdownInterval
                );

                countdownInterval = null;
            }
        }


        // ============================================================
        // DATE PAGE ENTER
        // ============================================================

        function onDatePageEntered() {

            if (datePageActive) {
                return;
            }

            datePageActive = true;

            firstCycleDone = false;
            lastSelectedDate = null;
            resetDateSequence();

            log('DATE PAGE DETECTED');

            updateStatus(
                automationEnabled
                    ? 'Date page found'
                    : 'OFF'
            );


            // If automation is ON:
            // middle date immediately
            if (automationEnabled) {

                runCycle(true);
            }
        }


        // ============================================================
        // DATE PAGE LEFT
        // ============================================================

        function onDatePageLeft() {

            datePageActive = false;

            firstCycleDone = false;
            lastSelectedDate = null;
            resetDateSequence();

            clearNextTimer();

            log('Date page left/reset');

            updateStatus(
                automationEnabled
                    ? 'Waiting for date page'
                    : 'OFF'
            );
        }


        // ============================================================
        // WATCH DATE PAGE — 1s WAITING CHECK, STOPS AFTER DATES FOUND
        // ============================================================

        function watchDatePage() {

            setInterval(
                () => {

                    // Outside the exact time-slot page:
                    // only reset state if we had already entered the date page.
                    // No calendar/button scan is performed here.
                    if (!isTimeSlotPage()) {

                        if (datePageActive) {
                            onDatePageLeft();
                        }

                        return;
                    }

                    // Once available dates have been found and the date flow is active,
                    // STOP continuous date searching. The existing sequence logic will
                    // do only the fresh lookups it needs for each turn.
                    if (datePageActive) {
                        return;
                    }

                    // Waiting state only:
                    // check once per second for the first available date(s).
                    const availableDates =
                        getAvailableDates();

                    if (availableDates.length > 0) {
                        onDatePageEntered();
                    }

                },
                WATCH_INTERVAL
            );
        }


        // ============================================================
        // STATUS
        // ============================================================

        function updateStatus(text) {

            if (statusElement) {
                statusElement.textContent = text;
            }
        }


        // ============================================================
        // ON / OFF
        // ============================================================

        function enableAutomation() {

            automationEnabled = true;

            safeSetItem(
                KEY_ENABLED,
                'true'
            );

            updateToggleUI();

            log('Automation ON');


            // Date page already open:
            // immediately start MIDDLE date
            if (getAvailableDates().length > 0) {

                datePageActive = true;

                clearNextTimer();

                // Turning ON starts a fresh sequence
                firstCycleDone = false;
                lastSelectedDate = null;
                resetDateSequence();

                runCycle(true);

            } else {

                updateStatus(
                    'Waiting for date page'
                );
            }
        }


        function disableAutomation() {

            automationEnabled = false;

            safeSetItem(
                KEY_ENABLED,
                'false'
            );

            clearNextTimer();
            resetDateSequence();

            updateToggleUI();

            updateStatus('OFF');

            log('Automation OFF');
        }


        function toggleAutomation() {

            if (automationEnabled) {

                disableAutomation();

            } else {

                enableAutomation();
            }
        }


        function updateToggleUI() {

            if (!toggleButton) {
                return;
            }

            if (automationEnabled) {

                toggleButton.textContent =
                    'Auto Reserve: ON';

                toggleButton.style.background =
                    '#16a34a';

                toggleButton.style.color =
                    '#ffffff';

            } else {

                toggleButton.textContent =
                    'Auto Reserve: OFF';

                toggleButton.style.background =
                    '#dc2626';

                toggleButton.style.color =
                    '#ffffff';
            }
        }


        // ============================================================
        // DATE MODE: 1-M / M+1 / MR / FL / LF
        // ============================================================

        function updateModeUI() {

            ['1-M', 'M+1', 'MR', 'FL', 'LF'].forEach(mode => {

                const button = modeButtons[mode];

                if (!button) {
                    return;
                }

                const selected =
                    mode === dateMode;

                button.style.background =
                    selected
                        ? '#16a34a'
                        : '#374151';

                button.style.color =
                    '#ffffff';

                button.style.border =
                    selected
                        ? '1px solid #22c55e'
                        : '1px solid #4b5563';
            });
        }


        function selectDateMode(mode) {

            if (!['1-M', 'M+1', 'MR', 'FL', 'LF'].includes(mode)) {
                return;
            }

            if (dateMode === mode) {
                updateModeUI();
                return;
            }

            dateMode = mode;

            safeSetItem(
                KEY_DATE_MODE,
                dateMode
            );

            // Start a fresh sequence on the next cycle so the newly
            // selected mode takes effect cleanly.
            resetDateSequence();

            updateModeUI();

            updateStatus(
                `Mode: ${dateMode}`
            );

            log(
                `Date mode changed: ${dateMode}`
            );
        }


        // ============================================================
        // SAVE INTERVAL
        // ============================================================

        function saveInterval() {

            let newMin =
                parseInt(
                    minInput.value,
                    10
                );

            let newMax =
                parseInt(
                    maxInput.value,
                    10
                );


            if (
                !Number.isFinite(newMin) ||
                newMin < 1
            ) {

                newMin =
                    DEFAULT_MIN_SECONDS;
            }


            if (
                !Number.isFinite(newMax) ||
                newMax < 1
            ) {

                newMax =
                    DEFAULT_MAX_SECONDS;
            }


            // Swap if reversed
            if (newMin > newMax) {

                [newMin, newMax] =
                    [newMax, newMin];
            }


            minSeconds = newMin;
            maxSeconds = newMax;


            minInput.value =
                minSeconds;

            maxInput.value =
                maxSeconds;


            safeSetItem(
                KEY_MIN_SECONDS,
                String(minSeconds)
            );

            safeSetItem(
                KEY_MAX_SECONDS,
                String(maxSeconds)
            );


            log(
                `Interval saved: ${minSeconds}-${maxSeconds} sec`
            );


            updateStatus(
                `Saved ${minSeconds}-${maxSeconds}s`
            );


            // If currently running, reset next timer
            // using the new interval
            if (
                automationEnabled &&
                datePageActive &&
                !cycleRunning
            ) {

                scheduleNextCycle();
            }
        }



        // ============================================================
        // DRAGGABLE PANEL
        // Default position stays BOTTOM-LEFT. Drag using the title.
        // ============================================================

        function makePanelDraggable(panel, handle) {

            let dragging = false;
            let offsetX = 0;
            let offsetY = 0;

            handle.style.cursor = 'move';
            handle.style.touchAction = 'none';

            handle.addEventListener('pointerdown', (event) => {

                if (event.button !== undefined && event.button !== 0) {
                    return;
                }

                const rect = panel.getBoundingClientRect();

                // Convert the original bottom-left positioning to left/top
                // only when the user starts dragging.
                panel.style.left = rect.left + 'px';
                panel.style.top = rect.top + 'px';
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';

                offsetX = event.clientX - rect.left;
                offsetY = event.clientY - rect.top;

                dragging = true;

                try {
                    handle.setPointerCapture(event.pointerId);
                } catch (e) {}

                event.preventDefault();
            });

            handle.addEventListener('pointermove', (event) => {

                if (!dragging) {
                    return;
                }

                const rect = panel.getBoundingClientRect();

                let left = event.clientX - offsetX;
                let top = event.clientY - offsetY;

                const maxLeft = Math.max(0, window.innerWidth - rect.width);
                const maxTop = Math.max(0, window.innerHeight - rect.height);

                left = Math.min(Math.max(0, left), maxLeft);
                top = Math.min(Math.max(0, top), maxTop);

                panel.style.left = left + 'px';
                panel.style.top = top + 'px';
            });

            function stopDragging(event) {

                if (!dragging) {
                    return;
                }

                dragging = false;

                try {
                    handle.releasePointerCapture(event.pointerId);
                } catch (e) {}
            }

            handle.addEventListener('pointerup', stopDragging);
            handle.addEventListener('pointercancel', stopDragging);
        }

        // ============================================================
        // CREATE BOTTOM LEFT PANEL
        // ============================================================

        function createControlPanel() {

            if (
                document.getElementById(
                    'ivac-date-auto-panel'
                )
            ) {
                return;
            }


            const panel =
                document.createElement('div');


            panel.id =
                'ivac-date-auto-panel';


            panel.style.cssText = `
                position: fixed;
                left: 12px;
                bottom: 12px;
                z-index: 2147483647;
                width: 190px;
                background: rgba(17, 24, 39, 0.96);
                color: white;
                border-radius: 12px;
                padding: 10px;
                box-shadow: 0 5px 20px rgba(0,0,0,0.30);
                font-family: Arial, sans-serif;
                font-size: 12px;
                user-select: none;
            `;

            // Embedded layout (UI only): flow inside the main panel, 300px wide
            panel.style.position = 'static';
            panel.style.width = '100%';
            panel.style.boxSizing = 'border-box';
            panel.style.boxShadow = 'none';
            panel.style.marginTop = '8px';
            panel.style.zIndex = '';


            // --------------------------------------------------------
            // TITLE
            // --------------------------------------------------------

            const title =
                document.createElement('div');


            title.textContent =
                'IVAC DATE AUTO';


            title.style.cssText = `
                font-size: 13px;
                display : none;
                font-weight: bold;
                text-align: center;
                margin-bottom: 8px;
            `;


            panel.appendChild(title);


            // Drag panel by holding the title.
            // makePanelDraggable disabled: panel is embedded in the main panel


            // --------------------------------------------------------
            // TOGGLE BUTTON
            // --------------------------------------------------------

            toggleButton =
                document.createElement('button');


            toggleButton.type =
                'button';


            toggleButton.style.cssText = `

                width: 100%;
                border: none;
                border-radius: 8px;
                padding: 8px;
                cursor: pointer;
                font-size: 13px;
                font-weight: bold;
                margin-bottom: 8px;
            `;


            toggleButton.addEventListener(
                'click',
                toggleAutomation
            );


            panel.appendChild(
                toggleButton
            );


            // --------------------------------------------------------
            // DATE MODE BUTTONS: (1-M) (M+1) (MR) (FL) (LF)
            // --------------------------------------------------------

            const modeRow =
                document.createElement('div');

            modeRow.style.cssText = `

                display: flex;
                gap: 3px;
                margin-bottom: 8px;
            `;

            ['1-M', 'M+1', 'MR', 'FL', 'LF'].forEach(mode => {

                const modeButton =
                    document.createElement('button');

                modeButton.type =
                    'button';

                modeButton.textContent =
                    `(${mode})`;

                modeButton.style.cssText = `

                    flex: 1;
                    min-width: 0;
                    padding: 5px 1px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 9px;
                    font-weight: bold;
                    line-height: 1.1;
                `;

                modeButton.addEventListener(
                    'click',
                    () => selectDateMode(mode)
                );

                modeButtons[mode] =
                    modeButton;

                modeRow.appendChild(
                    modeButton
                );
            });

            panel.appendChild(
                modeRow
            );

            updateModeUI();


            // --------------------------------------------------------
            // MIN
            // --------------------------------------------------------

            const minRow =
                document.createElement('div');


            minRow.style.cssText = `
                display: flex;
display: none;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 5px;
            `;


            const minLabel =
                document.createElement('span');


            minLabel.textContent =

                'Min sec';


            minInput =
                document.createElement('input');


            minInput.type =
                'number';


            minInput.min =
                '1';


            minInput.value =
                minSeconds;


            minInput.style.cssText = `
                width: 65px;
                display: none;
                padding: 4px;
                border-radius: 5px;
                border: 1px solid #555;
                background: white;
                color: black;
                text-align: center;
            `;


            minRow.appendChild(
                minLabel
            );


            minRow.appendChild(
                minInput
            );


            panel.appendChild(
                minRow
            );


            // --------------------------------------------------------
            // MAX
            // --------------------------------------------------------

            const maxRow =
                document.createElement('div');


            maxRow.style.cssText = `

                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 7px;
                display: none;
            `;


            const maxLabel =
                document.createElement('span');


            maxLabel.textContent =
                'Max sec';
maxLabel.style.cssText = 'display: none';

            maxInput =
                document.createElement('input');


            maxInput.type =
                'number';


            maxInput.min =
                '1';


            maxInput.value =
                maxSeconds;


            maxInput.style.cssText = `


display: none;
                width: 65px;
                padding: 4px;
                border-radius: 5px;
                border: 1px solid #555;
                background: white;
                color: black;
                text-align: center;
            `;


            maxRow.appendChild(
                maxLabel
            );


            maxRow.appendChild(
                maxInput
            );


            panel.appendChild(
                maxRow
            );


            // --------------------------------------------------------
            // CONTINUE WAIT: AUTO-SAVED SECONDS
            // --------------------------------------------------------

            const continueWaitRow = document.createElement('div');
            continueWaitRow.style.cssText = `
                display: flex;
display: none;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 7px;
            `;

            const continueWaitLabel = document.createElement('label');
            continueWaitLabel.textContent = 'Continue wait (sec)';
            continueWaitLabel.htmlFor = 'ivac-date-continue-wait-seconds';

            const continueWaitInput = document.createElement('input');
            continueWaitInput.id = 'ivac-date-continue-wait-seconds';
            continueWaitInput.type = 'number';
            continueWaitInput.min = '1';
            continueWaitInput.step = 'any';
            continueWaitInput.value = continueWaitSeconds;
            continueWaitInput.style.cssText = minInput.style.cssText;

            continueWaitInput.addEventListener('input', () => {
                const seconds = Number(continueWaitInput.value);
                if (!Number.isFinite(seconds) || seconds < 1) {
                    return;
                }
                continueWaitSeconds = seconds;
                safeSetItem(KEY_CONTINUE_WAIT_SECONDS, seconds);
            });

            continueWaitRow.appendChild(continueWaitLabel);
            continueWaitRow.appendChild(continueWaitInput);
            panel.appendChild(continueWaitRow);


            // --------------------------------------------------------
            // SAVE BUTTON
            // --------------------------------------------------------

            const saveButton =
                document.createElement('button');


            saveButton.type =
                'button';


            saveButton.textContent =
                'SAVE INTERVAL';


            saveButton.style.cssText = `
display: none;
                width: 100%;
                background: #FF671F;
                color: white;
                border: none;
                border-radius: 7px;
                padding: 6px;
                cursor: pointer;
                font-size: 11px;
                font-weight: bold;
                margin-bottom: 7px;
            `;


            saveButton.addEventListener(
                'click',
                saveInterval
            );


            panel.appendChild(
                saveButton
            );


            // --------------------------------------------------------
            // STATUS
            // --------------------------------------------------------

            statusElement =
                document.createElement('div');


            statusElement.style.cssText = `

                text-align: center;
                font-size: 11px;
                color: #fde68a;
                min-height: 14px;
                line-height: 14px;
            `;


            panel.appendChild(
                statusElement
            );


            const mountTarget =
                document.getElementById('ivac-auto-panel') ||
                document.body ||
                document.documentElement;

            if (!mountTarget) {
                return;
            }
                        panel.style.order = '4';

            mountTarget.appendChild(
                panel
            );


            updateToggleUI();


            if (automationEnabled) {

                updateStatus(
                    isIVACPage()
                        ? 'Waiting for date page'
                        : 'ON - waiting for IVAC'
                );

            } else {

                updateStatus('OFF');
            }
        }


        // ============================================================
        // START
        // ============================================================

        function ensureControlPanel() {

            try {

                if (!document.getElementById('ivac-date-auto-panel')) {
                    createControlPanel();
                }

            } catch (error) {

                console.error(
                    '[IVAC AUTO] PANEL ERROR:',
                    error
                );
            }
        }


        function keepPanelAlive() {

            ensureControlPanel();

            // If a SPA/blank page replaces or clears the BODY,
            // recreate the panel automatically.
            const observer = new MutationObserver(() => {
                ensureControlPanel();
            });

            const root = document.documentElement;

            if (root) {
                observer.observe(root, {
                    childList: true,
                    subtree: true
                });
            }

            // Extra fallback for aggressive page re-renders.
            setInterval(
                ensureControlPanel,
                1000
            );
        }


        function start() {

            if (scriptStarted) {
                ensureControlPanel();
                return;
            }

            scriptStarted = true;

            keepPanelAlive();

            // IMPORTANT: date automation itself stays IVAC-only.
            if (isIVACPage()) {
                watchDatePage();
            }

            log(
                `Loaded. Interval: ${minSeconds}-${maxSeconds} sec`
            );

            log(
                `Automation: ${automationEnabled ? 'ON' : 'OFF'}`
            );

            log(
                `Date mode: ${dateMode}`
            );
        }


        // ============================================================
        // DOCUMENT READY
        // ============================================================

        // Early panel mount. Keeps the original BOTTOM-LEFT position.
        let earlyMountAttempts = 0;

        const earlyMountTimer = setInterval(() => {

            earlyMountAttempts++;

            if (document.documentElement) {
                ensureControlPanel();
            }

            if (document.readyState !== 'loading') {
                start();
            }

            if (
                scriptStarted ||
                earlyMountAttempts >= 100
            ) {
                clearInterval(earlyMountTimer);
            }

        }, 50);


        if (
            document.readyState === 'loading'
        ) {

            document.addEventListener(
                'DOMContentLoaded',
                start,
                {
                    once: true
                }
            );

        } else {

            start();
        }

    })();

    // =================================================================
    // INITIATE / CONTINUE PAYMENT PANEL (embedded, functions unchanged)
    // =================================================================
    (function () {
        'use strict';

        // =========================================================
        // SETTINGS
        // =========================================================
        const KEY_ENABLED = 'ivac_continue_auto_enabled';
        const KEY_SECONDS = 'ivac_continue_auto_seconds';

        const DEFAULT_SECONDS = 20;
        const CHECK_INTERVAL_MS = 1000; // optimized: one check per second
        const CONTINUE_PAYMENT_PATH = '/appointment/continue-payment';

        let enabled = localStorage.getItem(KEY_ENABLED) === 'true';

        let savedSeconds = parseFloat(
            localStorage.getItem(KEY_SECONDS) || DEFAULT_SECONDS
        );

        if (!Number.isFinite(savedSeconds) || savedSeconds < 1) {
            savedSeconds = DEFAULT_SECONDS;
        }

        let timer = null;
        let nextAttemptAt = 0;
        let lastClickAt = 0;
        let firstReadyAt = 0;
        let clickLock = false;


        // =========================================================
        // HELPERS
        // =========================================================

        function normalize(text) {
            return (text || '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function isContinuePaymentPage() {
            return location.pathname === CONTINUE_PAYMENT_PATH;
        }


        // =========================================================
        // FIND VALID TOTAL AMOUNT
        // =========================================================

        function getTotalAmount() {

            const allElements = document.querySelectorAll('div, span');

            for (const el of allElements) {

                // We want the actual Total Amount container,
                // not the entire page/body.
                const children = Array.from(el.children);

                if (children.length < 2 || children.length > 5) {
                    continue;
                }

                const texts = children.map(child =>
                    normalize(child.textContent)
                );

                const labelIndex = texts.findIndex(text =>
                    /^Total Amount$/i.test(text)
                );

                if (labelIndex === -1) {
                    continue;
                }

                // Look for BDT amount inside the SAME container.
                for (const text of texts) {

                    const match = text.match(
                        /^BDT\s+([\d,]+(?:\.\d{1,2})?)$/i
                    );

                    if (!match) continue;

                    const amount = parseFloat(
                        match[1].replace(/,/g, '')
                    );

                    if (
                        Number.isFinite(amount) &&
                        amount > 0
                    ) {
                        return {
                            found: true,
                            amount: amount,
                            text: text,
                            element: el
                        };
                    }
                }
            }

            return {
                found: false,
                amount: 0,
                text: '',
                element: null
            };
        }


        // =========================================================
        // FIND CONTINUE PAYMENT BUTTON
        // =========================================================

        function getContinueButton() {

            const buttons = document.querySelectorAll('button');

            for (const button of buttons) {

                const text = normalize(button.textContent);

                if (/^Continue Payment$/i.test(text)) {
                    return button;
                }
            }

            return null;
        }


        // =========================================================
        // BUTTON CLICKABLE CHECK
        // =========================================================

        function isButtonClickable(button) {

            if (!button) return false;

            if (button.disabled) return false;

            if (button.hasAttribute('disabled')) return false;

            if (button.getAttribute('aria-disabled') === 'true') {
                return false;
            }

            const style = window.getComputedStyle(button);

            if (style.display === 'none') return false;
            if (style.visibility === 'hidden') return false;
            if (style.pointerEvents === 'none') return false;

            const rect = button.getBoundingClientRect();

            if (rect.width <= 0 || rect.height <= 0) {
                return false;
            }

            return true;
        }


        // =========================================================
        // PANEL
        // =========================================================

        const panel = document.createElement('div');

        panel.id = 'ivac-continue-safe-panel';

        panel.innerHTML = `
            <div class="ivac-title">
                CONTINUE PAYMENT
            </div>

            <button id="ivacContinueToggle">
                AUTO: OFF
            </button>

            <div class="ivac-row">
                <span>Seconds</span>

                <input
                    id="ivacContinueSeconds"
                    type="number"
                    min="1"
                    step="1"
                    value="${savedSeconds}"
                >
            </div>

            <button id="ivacContinueSave">
                SAVE
            </button>

            <div id="ivacContinueStatus">
                OFF
            </div>
        `;

        // Embedded inside the main UPLOAD panel (UI placement only).
        (document.getElementById('ivac-auto-panel') || document.body).appendChild(panel);
                panel.style.order = '5';


        // =========================================================
        // PANEL STYLE
        // =========================================================

        const style = document.createElement('style');

        style.textContent = `

            #ivac-continue-safe-panel {

                position: static;
                width: 100%;
                box-sizing: border-box;
                margin-top: 0px;

                background: rgba(17,24,39,.97);
                color: white;

                border-radius: 12px;
                padding: 2px;

                box-shadow: none;

                font-family: Arial, sans-serif;
                font-size: 12px;

                user-select: none;
            }

            #ivac-continue-safe-panel .ivac-title {
             Display : none;
                font-size: 13px;
                font-weight: bold;
                text-align: center;
                margin-bottom: 0px;
            }

            #ivacContinueToggle {
                width: 100%;
                border: none;
                border-radius: 8px;
                padding: 8px;

                cursor: pointer;

                font-size: 13px;
                font-weight: bold;

                margin-bottom: 0px;
            }

            #ivac-continue-safe-panel .ivac-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
 Display : none;
                margin-bottom: 7px;
            }

            #ivacContinueSeconds {
                width: 65px;
 Display : none;
                padding: 5px;

                border-radius: 5px;
                border: 1px solid #555;

                background: white;
                color: black;

                text-align: center;
                font-weight: bold;
            }

            #ivacContinueSave {
                width: 100%;
 Display : none;
                background: #FF671F;
                color: white;

                border: none;
                border-radius: 7px;

                padding: 7px;

                cursor: pointer;

                font-size: 11px;
                font-weight: bold;

                margin-bottom: 7px;
            }

            #ivacContinueStatus {
                text-align: center;
 Display : none;
                font-size: 11px;
                font-weight: bold;

                color: #fde68a;

                min-height: 28px;
                line-height: 14px;
            }

        `;

        document.head.appendChild(style);


        // =========================================================
        // PANEL ELEMENTS
        // =========================================================

        const toggleButton =
            document.getElementById('ivacContinueToggle');

        const secondsInput =
            document.getElementById('ivacContinueSeconds');

        const saveButton =
            document.getElementById('ivacContinueSave');

        const status =
            document.getElementById('ivacContinueStatus');


        // =========================================================
        // UI UPDATE
        // =========================================================

        function updateToggleUI() {

            if (enabled) {

                toggleButton.textContent = 'Auto Initiate: ON';

                toggleButton.style.background = '#16a34a';
                toggleButton.style.color = '#ffffff';

            } else {

                toggleButton.textContent = 'Auto Initiate: OFF';

                toggleButton.style.background = '#dc2626';
                toggleButton.style.color = '#ffffff';

                status.textContent = 'OFF';
            }
        }


        // =========================================================
        // SAVE SECONDS
        // =========================================================

        saveButton.addEventListener('click', function () {

            let value = parseFloat(secondsInput.value);

            if (!Number.isFinite(value) || value < 1) {
                value = DEFAULT_SECONDS;
            }

            savedSeconds = value;

            secondsInput.value = savedSeconds;

            localStorage.setItem(
                KEY_SECONDS,
                String(savedSeconds)
            );

            // The interval is measured from the last successful click.
            if (lastClickAt) {
                nextAttemptAt = lastClickAt + savedSeconds * 1000;
            }

            status.textContent =
                `Saved: ${savedSeconds} sec`;
        });


        // =========================================================
        // ON / OFF
        // =========================================================

        toggleButton.addEventListener('click', function () {

            enabled = !enabled;

            localStorage.setItem(
                KEY_ENABLED,
                String(enabled)
            );

            updateToggleUI();

            if (enabled) {

                nextAttemptAt = 0;
                lastClickAt = 0;
                firstReadyAt = 0;

                status.textContent =
                    'Checking Total Amount...';

                startWatcher();

            } else {

                stopWatcher();
            }
        });


        // =========================================================
        // MAIN SAFE CHECK
        // =========================================================

        function safeCheckAndClick() {

            if (!enabled) return;

            // Exact fixed page only.
            if (!isContinuePaymentPage()) {
                firstReadyAt = 0;
                status.textContent = 'AUTO ON - Waiting for payment page';
                return;
            }

            if (clickLock) return;

            const amountData = getTotalAmount();


            // -----------------------------------------------------
            // ABSOLUTE RULE:
            // NO VALID TOTAL AMOUNT = NEVER CLICK
            // -----------------------------------------------------

            if (!amountData.found) {
                firstReadyAt = 0;

                status.innerHTML =
                    'WAITING...<br>Total Amount not loaded';

                return;
            }


            status.innerHTML =
                `Amount OK: ${amountData.text}<br>Checking button...`;


            // -----------------------------------------------------
            // FIND CONTINUE BUTTON
            // -----------------------------------------------------

            const button = getContinueButton();

            if (!button) {
                firstReadyAt = 0;

                status.innerHTML =
                    `Amount OK: ${amountData.text}<br>Waiting for button`;

                return;
            }


            // -----------------------------------------------------
            // CHECK BUTTON ENABLED / CLICKABLE
            // -----------------------------------------------------

            if (!isButtonClickable(button)) {
                firstReadyAt = 0;

                status.innerHTML =
                    `Amount OK: ${amountData.text}<br>Button not clickable`;

                return;
            }


            // -----------------------------------------------------
            // FINAL CHECK AGAIN IMMEDIATELY BEFORE CLICK
            // -----------------------------------------------------

            const finalAmountCheck = getTotalAmount();

            if (!finalAmountCheck.found) {
                firstReadyAt = 0;

                status.innerHTML =
                    'BLOCKED<br>Total Amount disappeared';

                return;
            }

            // Only the first click waits for two continuous seconds of readiness.
            if (!lastClickAt) {
                if (!firstReadyAt) firstReadyAt = Date.now();
                const remaining = 2000 - (Date.now() - firstReadyAt);
                if (remaining > 0) {
                    status.innerHTML =
                        `${finalAmountCheck.text}<br>First click in ${(remaining / 1000).toFixed(1)}s`;
                    return;
                }
            }


            // -----------------------------------------------------
            // CLICK
            // -----------------------------------------------------

            clickLock = true;

            status.innerHTML =
                `${finalAmountCheck.text}<br>CLICKING...`;

            try {

                button.click();

            } catch (error) {

                clickLock = false;

                status.innerHTML =
                    'Click error - retrying';

                return;
            }


            lastClickAt = Date.now();
            firstReadyAt = 0;
            nextAttemptAt = lastClickAt + savedSeconds * 1000;

            // Prevent repeated rapid clicks.
            setTimeout(() => {

                clickLock = false;

            }, 300);
        }


        // =========================================================
        // WATCHER
        // =========================================================

        function startWatcher() {

            if (timer) return;

            timer = setInterval(function () {

                if (!enabled) return;

                // Exact fixed page only: no amount/button scan elsewhere.
                if (!isContinuePaymentPage()) {
                    firstReadyAt = 0;
                    status.textContent = 'AUTO ON - Waiting for payment page';
                    return;
                }

                const now = Date.now();

                if (now < nextAttemptAt) {

                    const remaining =
                        Math.ceil((nextAttemptAt - now) / 1000);

                    // Still only once per second.
                    const amount = getTotalAmount();

                    if (!amount.found) {

                        status.innerHTML =
                            `WAITING AMOUNT<br>Next check: ${remaining}s`;

                    } else {

                        status.innerHTML =
                            `${amount.text}<br>Next check: ${remaining}s`;
                    }

                    return;
                }


                safeCheckAndClick();

            }, CHECK_INTERVAL_MS);
        }


        function stopWatcher() {

            if (timer) {

                clearInterval(timer);

                timer = null;
            }

            status.textContent = 'OFF';
        }


        // =========================================================
        // INITIAL STATE
        // =========================================================

        updateToggleUI();

        if (enabled) {

            // On reload, wait for valid amount and a clickable button,
            // then use the original 2-second first-click safety.
            nextAttemptAt = 0;

            status.textContent =
                'Waiting for Total Amount...';

            startWatcher();
        }

    })();


    /***************************************************************
     * SYNC STAGE FROM TOTAL
     *
     * Screenshot-এর মতো:
     *
     * Total = 2
     * => Primary + Other1 done
     * => NEXT = Other2
     ***************************************************************/

    function syncStageFromCountForStart() {

        const total =
            getTotalApplicants();


        /*
         * Saved pending থাকলে count আগে reconcile করবে।
         * Count expected value-এ পৌঁছে গেলে pending complete।
         * না হলে saved pending position-ই রাখা হবে।
         */

        if (restoredPendingState) {

            if (
                total !== null &&
                total >=
                    restoredPendingState.expectedTotal
            ) {

                stage =
                    Math.max(
                        stage,
                        restoredPendingState.stage + 1
                    );


                restoredPendingState =
                    null;


                persistRuntimeState();


                console.log(
                    '[IVAC RESTORE] SAVED PENDING ALREADY COMPLETE BY COUNT',
                    '| Total:',
                    total,
                    '| Stage:',
                    stage
                );
            }


            return;
        }


        if (total === null) {

            persistRuntimeState();

            return;
        }


        /*
         * No pending:
         * saved stage কখনও count-এর কারণে পিছনে যাবে না।
         * Count এগিয়ে থাকলে শুধু forward sync হবে।
         */

        if (
            total >= 0 &&
            total <= requiredTotal
        ) {

            stage =
                Math.max(
                    stage,
                    total
                );


            persistRuntimeState();
        }
    }


    /***************************************************************
     * FRESH PAGE / NEW CASE AUTO-START FIX — v5.9.2
     *
     * Why this is needed:
     * The IVAC flow can move to a new upload page while the same
     * userscript context is still alive, or an old runtime stage may
     * survive briefly. Example: previous case finished at stage 4,
     * but the new page starts again at:
     *
     *   Total number of applicants: 0
     *   + visible PRIMARY upload control
     *
     * In that situation the old code could stay at stage 4 and show
     * "WAIT TOTAL 0/4 - NO CONFIRM" until AUTO was toggled OFF/ON.
     *
     * This guard recognizes a genuinely fresh PRIMARY page and clears
     * only STALE later-stage/confirm state. A real PRIMARY upload that
     * is already pending (stage 0) is left untouched, so normal upload
     * waiting/retry behavior remains unchanged.
     ***************************************************************/

    function resetStaleStateOnFreshPrimaryPage() {

        const total =
            getTotalApplicants();

        const primary =
            getPrimaryUploader();

        const other =
            getOtherUploader();


        const looksLikeFreshPrimaryPage =
            total === 0 &&
            Boolean(primary) &&
            !other;


        if (!looksLikeFreshPrimaryPage) {
            return false;
        }


        const staleWaitingUpload =
            Boolean(
                waitingUpload &&
                waitingUpload.stage !== 0
            );

        const staleRestoredPending =
            Boolean(
                restoredPendingState &&
                restoredPendingState.stage !== 0
            );

        const hasStaleState =
            stage !== 0 ||
            staleWaitingUpload ||
            staleRestoredPending ||
            confirmClicked;


        if (!hasStaleState) {

            // Important: do NOT disturb a legitimate PRIMARY pending upload.
            return false;
        }


        console.log(
            '[IVAC FRESH PAGE] NEW PRIMARY PAGE DETECTED → RESET STALE STATE',
            '| Old stage:',
            stage,
            '| Total:',
            total,
            '| Confirm clicked:',
            confirmClicked,
            '| Waiting:',
            waitingUpload
                ? FILES[waitingUpload.stage]?.title
                : 'NO',
            '| Restored pending:',
            restoredPendingState
                ? FILES[restoredPendingState.stage]?.title
                : 'NO'
        );


        stage = 0;

        waitingUpload =
            null;

        restoredPendingState =
            null;

        confirmClicked =
            false;

        errorRetryUntil =
            0;


        persistRuntimeState();


        setStatus(
            'NEW PAGE ✓ → PRIMARY AUTO START',
            '#07883c'
        );


        return true;
    }


    /***************************************************************
     * MAIN AUTOMATION
     ***************************************************************/

    async function runAutomation() {

        if (!autoEnabled) {
            return;
        }

        // IMPORTANT OPTIMIZATION:
        // Upload DOM scanning/automation must never run outside the exact
        // /appointment/file-upload page. Panel controls remain available.
        if (!isFileUploadPage()) {
            setStatus(
                'AUTO ON - WAIT FILE UPLOAD PAGE',
                '#cc7900'
            );
            return;
        }


        if (processing) {
            return;
        }


        /*
         * Run this BEFORE the confirmClicked guard.
         * If a completed case moved to a fresh upload page in the same
         * tab/script context, confirmClicked may still be true.
         * The fresh-page detector clears that stale state automatically.
         */
        resetStaleStateOnFreshPrimaryPage();


        if (confirmClicked) {
            return;
        }


        processing =
            true;


        try {

            /********************************************************
             * FILES READY?
             ********************************************************/

            if (
                !(await allFilesReady())
            ) {

                setStatus(
                    `SET ${requiredTotal} FILE${requiredTotal === 1 ? '' : 'S'} FIRST`,
                    '#d62828'
                );


                return;
            }


            /********************************************************
             * RESTORE PENDING AFTER RELOAD
             ********************************************************/

            hydrateRestoredPendingIfNeeded();


            /********************************************************
             * WAITING PREVIOUS UPLOAD?
             ********************************************************/

            if (waitingUpload) {

                const completed =
                    await checkWaitingUpload();


                if (!completed) {

                    return;
                }


                /*
                 * Count success / error retry / next-button success হলে
                 * নিচে একই run-এই continue করবে।
                 */
            }


            /********************************************************
             * ERROR RETRY BREAK — 5 SECONDS
             *
             * Error detect হওয়ার পর same file সাথে সাথে resend হবে না।
             * 1-second scanner / MutationObserver check চালু থাকবে,
             * কিন্তু retry attach minimum 5 seconds পরে হবে।
             ********************************************************/

            if (
                errorRetryUntil &&
                Date.now() <
                    errorRetryUntil
            ) {

                const remainingSeconds =
                    Math.max(
                        1,
                        Math.ceil(
                            (
                                errorRetryUntil -
                                Date.now()
                            ) /
                            1000
                        )
                    );


                setStatus(
                    `ERROR BREAK → RETRY IN ${remainingSeconds}S`,
                    '#cc7900'
                );


                return;
            }


            if (
                errorRetryUntil &&
                Date.now() >=
                    errorRetryUntil
            ) {

                errorRetryUntil = 0;
            }


            const total =
                getTotalApplicants();


            /********************************************************
             * v5.9 NAME-AWARE STAGE SYNC
             *
             * Count tells HOW MANY are on the page.
             * Applicant cards tell WHICH saved files are there.
             *
             * So before choosing the next file, correct the stage
             * to the first actually missing saved filename.
             ********************************************************/

            const nameState =
                await syncStageFromApplicantNames();


            /*
             * Page is between count update and applicant-card render.
             * Wait briefly instead of making a decision from stale names.
             */
            if (
                nameState.syncing
            ) {

                setStatus(
                    `WAIT NAME SYNC ${nameState.applicantNames.length}/${nameState.total}`,
                    '#cc7900'
                );


                return;
            }


            /********************************************************
             * FINAL CONFIRM GATE
             *
             * Selected UPLOAD count-এর সাথে page total EXACT match না
             * করলে Confirm কখনো click করবে না।
             ********************************************************/

            if (
                stage >=
                    requiredTotal
            ) {

                if (
                    total !==
                    requiredTotal
                ) {

                    setStatus(
                        `WAIT TOTAL ${total === null ? '?' : total}/${requiredTotal} - NO CONFIRM`,
                        '#cc7900'
                    );


                    return;
                }


                const confirm =
                    findConfirmButton();


                if (!confirm) {

                    setStatus(
                        `${requiredTotal}/${requiredTotal} - WAIT CONFIRM`,
                        '#cc7900'
                    );


                    return;
                }


                if (
                    !confirmEnabled(
                        confirm
                    )
                ) {

                    setStatus(
                        `${requiredTotal}/${requiredTotal} - CONFIRM DISABLED`,
                        '#cc7900'
                    );


                    return;
                }


                /* FINAL DOUBLE CHECK */

                if (
                    getTotalApplicants() !==
                    requiredTotal
                ) {

                    return;
                }


                const finalButton =
                    findConfirmButton();


                if (
                    !finalButton ||
                    !confirmEnabled(
                        finalButton
                    )
                ) {

                    return;
                }


                confirmClicked =
                    true;


                // Flow complete; old stage/pending must not leak into next case.
                clearRuntimeState();


                setStatus(
                    `${requiredTotal}/${requiredTotal} → CONFIRM CLICK ✓`,
                    '#07883c'
                );


                console.log(
                    '[IVAC CONFIRM] CLICK ✓ | EXACT TOTAL MATCH',
                    requiredTotal
                );


                finalButton.click();


                return;
            }


            /********************************************************
             * PRIMARY
             ********************************************************/

            if (stage === 0) {

                const primary =
                    getPrimaryUploader();


                if (primary) {

                    setStatus(
                        'PRIMARY BUTTON FOUND → UPLOAD',
                        '#1464c0'
                    );


                    await attachFile(
                        primary,
                        0
                    );


                    return;
                }


                /*
                 * Resume/fallback: Primary button নেই কিন্তু OTHER button
                 * already ready এবং কোনো visible upload error নেই।
                 */

                const other =
                    getOtherUploader();

                const uploadError =
                    getVisibleUploadError();


                if (
                    other &&
                    !uploadError
                ) {

                    stage = 1;


                    persistRuntimeState();


                    setStatus(
                        'PRIMARY READY ✓ → OTHER 1',
                        '#07883c'
                    );


                    // নিচে OTHER 1 attach করবে।

                } else {

                    setStatus(
                        uploadError
                            ? 'PRIMARY ERROR - WAIT RETRY BUTTON'
                            : 'WAIT PRIMARY BUTTON',
                        uploadError
                            ? '#d62828'
                            : '#cc7900'
                    );


                    return;
                }
            }


            /********************************************************
             * OTHER 1 / OTHER 2 / OTHER 3
             ********************************************************/

            if (
                stage >= 1 &&
                stage < requiredTotal
            ) {

                const other =
                    getOtherUploader();


                if (!other) {

                    setStatus(
                        `WAIT ${FILES[stage].title} BUTTON`,
                        '#cc7900'
                    );


                    return;
                }


                setStatus(
                    `${FILES[stage].title} BUTTON FOUND → UPLOAD`,
                    '#1464c0'
                );


                await attachFile(
                    other,
                    stage
                );


                return;
            }


        } catch (error) {

            console.error(
                '[IVAC AUTO ERROR]',
                error
            );


            setStatus(
                'SCRIPT ERROR',
                '#d62828'
            );

        } finally {

            processing =
                false;
        }
    }


    /***************************************************************
     * AUTO BUTTON
     ***************************************************************/

    toggle.onclick =
        async () => {

            autoEnabled =
                !autoEnabled;


            GM_setValue(
                'IVAC_MASTER_AUTO_ENABLED',
                autoEnabled
            );


            if (autoEnabled) {

                confirmClicked =
                    false;

                errorRetryUntil =
                    0;


                waitingUpload =
                    null;

                restoredPendingState =
                    null;


                const restored =
                    restoreRuntimeStateFromStorage();


                const total =
                    getTotalApplicants();


                if (!restored) {

                    if (
                        total !== null
                    ) {

                        stage =
                            Math.min(
                                total,
                                requiredTotal
                            );
                    }


                    persistRuntimeState();
                } else {

                    syncStageFromCountForStart();
                }


                setStatus(
                    'AUTO WATCHING...',
                    '#07883c'
                );


                console.log(
                    '[IVAC AUTO] ON',
                    '| Stage:',
                    stage,
                    '| Total:',
                    total
                );


                if (isFileUploadPage()) {
                    runAutomation();
                } else {
                    setStatus(
                        'AUTO ON - WAIT FILE UPLOAD PAGE',
                        '#cc7900'
                    );
                }

            } else {

                waitingUpload =
                    null;

                errorRetryUntil =
                    0;


                setStatus(
                    'AUTO OFF',
                    '#d62828'
                );


                console.log(
                    '[IVAC AUTO] OFF'
                );
            }


            updateToggle();

            // Connect/disconnect the upload observer immediately according to
            // AUTO state + current exact page.
            updateUploadObserverState();
        };


    /***************************************************************
     * CONSOLE DEBUG
     ***************************************************************/

    let debugCount = 0;

    let debugLast =
        performance.now();


    function getStageName() {

        if (
            stage >= requiredTotal
        ) {

            return 'WAIT CONFIRM';
        }


        if (stage === 0) {
            return 'PRIMARY';
        }


        if (
            stage >= 1 &&
            stage < requiredTotal
        ) {

            return `OTHER ${stage}`;
        }


        return `STAGE ${stage}`;
    }


    function consoleDebug() {

        const now =
            performance.now();


        const interval =
            Math.round(
                now -
                debugLast
            );


        debugLast =
            now;


        debugCount++;


        const total =
            getTotalApplicants();


        const primary =
            getPrimaryUploader();


        const other =
            getOtherUploader();


        const confirm =
            findConfirmButton();


        const confirmStatus =
            confirm
                ? (
                    confirmEnabled(
                        confirm
                    )
                        ? 'ENABLED'
                        : 'DISABLED'
                )
                : 'NOT FOUND';


        const waiting =
            waitingUpload
                ? `${FILES[waitingUpload.stage].title} PENDING`
                : 'NO';


        console.log(
            `%c[IVAC CHECK #${debugCount}]`,
            'color:#07883c;font-weight:bold',

            `Interval: ${interval}ms |`,

            `Stage: ${getStageName()} |`,

            `Total: ${total === null ? '?' : total}/${requiredTotal} |`,

            `Primary: ${primary ? 'FOUND' : 'NO'} |`,

            `Other: ${other ? 'FOUND' : 'NO'} |`,

            `Waiting: ${waiting} |`,

            `Confirm: ${confirmStatus} |`,

            `Status: ${status.textContent}`
        );
    }


    /***************************************************************
     * MUTATION OBSERVER — EXACT FILE-UPLOAD PAGE ONLY
     *
     * Panel stays available everywhere, but the heavier DOM observer
     * is connected only while pathname is /appointment/file-upload.
     ***************************************************************/

    let mutationTimer =
        null;

    let observerActive =
        false;


    const observer =
        new MutationObserver(
            () => {

                if (
                    !autoEnabled ||
                    !isFileUploadPage()
                ) {
                    return;
                }


                clearTimeout(
                    mutationTimer
                );


                mutationTimer =
                    setTimeout(
                        runAutomation,
                        40
                    );
            }
        );


    function updateUploadObserverState() {

        const shouldObserve =
            autoEnabled &&
            isFileUploadPage();


        if (
            shouldObserve &&
            !observerActive
        ) {

            observer.observe(
                document.documentElement,
                {
                    childList:
                        true,

                    subtree:
                        true,

                    attributes:
                        true,

                    attributeFilter:
                        [
                            'disabled',
                            'class'
                        ]
                }
            );


            observerActive =
                true;


            console.log(
                '[IVAC OBSERVER] FILE-UPLOAD PAGE → ON'
            );


            return;
        }


        if (
            !shouldObserve &&
            observerActive
        ) {

            observer.disconnect();


            observerActive =
                false;


            clearTimeout(
                mutationTimer
            );


            mutationTimer =
                null;


            console.log(
                '[IVAC OBSERVER] OUTSIDE FILE-UPLOAD PAGE → OFF'
            );
        }
    }


    /***************************************************************
     * CONTINUOUS WATCH
     ***************************************************************/

    setInterval(
        () => {

            // Lightweight page gate runs once per second.
            // It attaches/detaches the heavy MutationObserver only when needed.
            updateUploadObserverState();


            if (!autoEnabled) {
                return;
            }


            if (!isFileUploadPage()) {

                setStatus(
                    'AUTO ON - WAIT FILE UPLOAD PAGE',
                    '#cc7900'
                );

                return;
            }


            consoleDebug();

            runAutomation();

        },
        CHECK_INTERVAL
    );


    /***************************************************************
     * INITIAL
     ***************************************************************/

    refreshFiles().then(() => syncRequiredTotal(false));


        // অন্য panel (Kafela) ফাইল বদলালে labels নতুন করে দেখাবে
    document.addEventListener('ivac-files-changed', () => {
        refreshFiles().then(() => syncRequiredTotal(false));
    });

    // Reload/new page: exact saved stage/pending আগে restore।
    // Saved state না থাকলে count-based start আগের মতো কাজ করবে।
    restoreRuntimeStateFromStorage();


    syncStageFromCountForStart();


    updateToggle();


    // Initial observer state depends on AUTO + exact page.
    updateUploadObserverState();


    if (autoEnabled) {

        if (isFileUploadPage()) {

            setStatus(
                'AUTO WATCHING...',
                '#07883c'
            );


            // Body ready হওয়ার পর যত দ্রুত সম্ভব current stage upload শুরু।
            setTimeout(
                runAutomation,
                50
            );

        } else {

            setStatus(
                'AUTO ON - WAIT FILE UPLOAD PAGE',
                '#cc7900'
            );
        }

    } else {

        setStatus(
            'AUTO OFF',
            '#d62828'
        );
    }


    console.log(
        '[IVAC AUTO] v5.9.3 Loaded | FILE-UPLOAD PAGE OPTIMIZED + NAME-AWARE FLOW'
    );

})();










(function () {
    'use strict';

    console.log('==================================================');
    console.log('[IVAC MASTER] 3-MODULE COMBINED SCRIPT STARTED');
    console.log('[IVAC MASTER] MODULE 1: CLOSE + TAKE APPOINTMENT + NEXT STEP');
    console.log('[IVAC MASTER] MODULE 2: MULTI-CENTER SELECT + CONFIRM');
    console.log('[IVAC MASTER] MODULE 3: SAVE & CONTINUE');
    console.log('==================================================');

    // ================================================================
    // MODULE 1 — CLOSE POPUP + TAKE APPOINTMENT + NEXT STEP
    // ================================================================
    try {
        (function () {
            'use strict';

            const CHECK_INTERVAL = 1000;

            let busy = false;
            let takeClicked = false;
            let nextClicked = false;
            let lastUrl = location.href;

            function isModule1Page() {
                const path = location.pathname.replace(/\/+$/, '') || '/';
                return path === '/' || path === '/appointment/notice';
            }

            function isVisible(el) {
                if (!el) return false;

                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();

                return (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0' &&
                    rect.width > 0 &&
                    rect.height > 0
                );
            }

            function getText(el) {
                return (el?.innerText || el?.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();
            }

            function safeClick(el, name) {
                if (!el || !isVisible(el)) return false;

                try {
                    console.log(`[IVAC AUTO] FOUND: ${name}`);
                    el.click();
                    console.log(`[IVAC AUTO] CLICKED: ${name}`);
                    return true;
                } catch (err) {
                    console.log(`[IVAC AUTO] CLICK ERROR: ${name}`, err);
                    return false;
                }
            }

            // ==================================================
            // CLOSE POPUPS
            // ==================================================

            function closePopups() {

                const path = location.pathname.replace(/\/+$/, '') || '/';
                if (path !== '/') return false;

                let clicked = false;

                const popupButtons = document.querySelectorAll(
                    'button[aria-label="Close popup"]'
                );

                for (const btn of popupButtons) {
                    if (isVisible(btn)) {
                        if (safeClick(btn, 'CLOSE ADVISORY POPUP')) {
                            clicked = true;
                        }
                    }
                }

                const noticeButtons = document.querySelectorAll(
                    'button[aria-label="Close notice"]'
                );

                for (const btn of noticeButtons) {
                    if (isVisible(btn)) {
                        if (safeClick(btn, 'CLOSE IMPORTANT NOTICE')) {
                            clicked = true;
                        }
                    }
                }

                return clicked;
            }

            // ==================================================
            // TAKE YOUR APPOINTMENT
            // ==================================================

            function clickTakeAppointment() {

                if (takeClicked) return false;

                const links = document.querySelectorAll(
                    'a[href="/appointment/notice"], a[href*="/appointment/notice"]'
                );

                for (const link of links) {

                    if (!isVisible(link)) continue;

                    const text = getText(link);

                    if (text.includes('take your appointment')) {

                        const clicked = safeClick(link, 'TAKE YOUR APPOINTMENT');

                        if (clicked) {
                            takeClicked = true;
                            return true;
                        }
                    }
                }

                const buttons = document.querySelectorAll('button');

                for (const btn of buttons) {

                    if (!isVisible(btn)) continue;

                    const text = getText(btn);

                    if (text.includes('take your appointment')) {

                        const clicked = safeClick(btn, 'TAKE YOUR APPOINTMENT');

                        if (clicked) {
                            takeClicked = true;
                            return true;
                        }
                    }
                }

                return false;
            }

            // ==================================================
            // NEXT STEP
            // ==================================================

            function clickNextStep() {

                if (nextClicked) return false;

                const buttons = document.querySelectorAll('button');

                for (const btn of buttons) {

                    if (!isVisible(btn)) continue;
                    if (btn.disabled) continue;

                    const text = getText(btn);

                    if (text === 'next step' || text.includes('next step')) {

                        console.log('[IVAC AUTO] NEXT STEP FOUND');

                        const clicked = safeClick(btn, 'NEXT STEP');

                        if (clicked) {
                            nextClicked = true;
                            return true;
                        }
                    }
                }

                return false;
            }

            // ==================================================
            // MAIN PROCESS
            // ==================================================

            function processPage() {

                if (!isModule1Page()) return;
                if (busy) return;

                busy = true;

                try {

                    // PRIORITY 1: Popup
                    const popupClosed = closePopups();

                    if (popupClosed) {

                        setTimeout(() => {
                            try {
                                closePopups();

                                setTimeout(() => {
                                    try {
                                        closePopups();
                                        clickTakeAppointment();
                                        clickNextStep();
                                    } catch (err) {
                                        console.log('[IVAC AUTO] DELAYED PROCESS ERROR:', err);
                                    }
                                }, 100);

                            } catch (err) {
                                console.log('[IVAC AUTO] POPUP PROCESS ERROR:', err);
                            }
                        }, 100);

                        return;
                    }

                    // PRIORITY 2: Take Your Appointment
                    if (clickTakeAppointment()) {
                        return;
                    }

                    // PRIORITY 3: Next Step
                    clickNextStep();

                } catch (err) {
                    console.log('[IVAC AUTO] PROCESS ERROR:', err);
                } finally {
                    busy = false;
                }
            }

            // ==================================================
            // MUTATION OBSERVER
            // ==================================================

            let observer = null;

            function startObserver() {

                if (!document.documentElement) {
                    setTimeout(startObserver, 100);
                    return;
                }

                if (observer) {
                    try {
                        observer.disconnect();
                    } catch (e) {}
                }

                observer = new MutationObserver(() => {
                    processPage();
                });

                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true
                });

                console.log('[IVAC AUTO] DOM OBSERVER STARTED');

                processPage();
            }

            startObserver();

            // ==================================================
            // PERMANENT 1-SECOND BACKUP CHECKER
            // ==================================================

            setInterval(() => {
                console.log('[IVAC AUTO] 1-SECOND CHECK');
                processPage();
            }, CHECK_INTERVAL);

            // ==================================================
            // SPA URL CHANGE DETECTOR
            // ==================================================

            setInterval(() => {

                if (location.href !== lastUrl) {

                    lastUrl = location.href;

                    console.log('[IVAC AUTO] URL CHANGED:', lastUrl);

                    nextClicked = false;

                    if (!location.pathname.startsWith('/appointment/')) {
                        takeClicked = false;
                    }

                    setTimeout(processPage, 100);
                    setTimeout(processPage, 1000);
                    setTimeout(processPage, 3000);
                }

            }, 1000);

            // ==================================================
            // PAGE LOAD EVENTS
            // ==================================================

            window.addEventListener('DOMContentLoaded', () => {
                console.log('[IVAC AUTO] DOM CONTENT LOADED');
                processPage();
            });

            window.addEventListener('load', () => {
                console.log('[IVAC AUTO] PAGE FULLY LOADED');
                processPage();
            });

            // ==================================================
            // TAB ACTIVE হলে আবার check
            // ==================================================

            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) {
                    console.log('[IVAC AUTO] TAB ACTIVE - CHECKING AGAIN');
                    processPage();
                }
            });

            console.log('[IVAC AUTO] SCRIPT STARTED - WILL KEEP CHECKING EVERY 1 SECOND');

        })();
    } catch (error) {
        console.error('[IVAC MASTER] MODULE 1 START ERROR:', error);
    }

    // ================================================================
    // MODULE 2 — MULTI-CENTER SELECT + CONFIRM
    // ================================================================
    try {
        (function () {
            'use strict';

            console.log('🚀 PAGE OPEN → MULTI-CENTER SCRIPT STARTED');

            // ==========================================================
            // SETTINGS
            // ==========================================================

            // পছন্দের ক্রমে লিখুন: উপরের center আগে চেষ্টা হবে
            const TARGETS = [
                'IVAC, Dhaka (JFP)',
                'IVAC, Khulna',
                'IVAC, Rajshahi',
                'IVAC, Sylhet',
                'IVAC, Chittagong'
            ];

            const DROPDOWN_LABEL = 'Select your IVAC center';
            const CONFIRM_TEXT = 'Confirm Mission & IVAC Center';
            const CHECK_INTERVAL = 1000;

            // Heavy Module 2 work only on Mission page
            function isModule2Page() {
                const path = location.pathname.replace(/\/+$/, '') || '/';
                return path === '/appointment/mission';
            }

            // ==========================================================
            // STATE
            // ==========================================================

            let lastDropdownClick = 0;
            let lastOptionClick = 0;
            let lastConfirmClick = 0;
            let optionsLogged = false;

            // ==========================================================
            // HELPERS
            // ==========================================================

            function clean(text) {
                return (text || '')
                    .replace(/\s+/g, ' ')
                    .trim();
            }

            // Text normalize: বাড়তি space বাদ, ছোট হাতের অক্ষর
            function norm(text) {
                return clean(text).toLowerCase();
            }

            function visible(el) {
                if (!el) return false;

                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);

                return (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0'
                );
            }

            // ==========================================================
            // HARD CLICK
            // ==========================================================

            function hardClick(el) {

                if (!el) return false;

                try {
                    el.scrollIntoView({ block: 'center', inline: 'center' });
                } catch (_) {}

                try {
                    el.focus();
                } catch (_) {}

                const rect = el.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;

                const options = {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    view: window,
                    clientX: x,
                    clientY: y
                };

                try { el.dispatchEvent(new PointerEvent('pointerdown', options)); } catch (_) {}
                try { el.dispatchEvent(new MouseEvent('mousedown', options)); } catch (_) {}
                try { el.dispatchEvent(new PointerEvent('pointerup', options)); } catch (_) {}
                try { el.dispatchEvent(new MouseEvent('mouseup', options)); } catch (_) {}

                try {
                    HTMLElement.prototype.click.call(el);
                } catch (_) {
                    try { el.click(); } catch (_) {}
                }

                return true;
            }

            // ==========================================================
            // FIND IVAC CENTER DROPDOWN
            // ==========================================================

            function findDropdown() {

                const buttons = document.querySelectorAll(
                    'button[type="button"], button'
                );

                for (const btn of buttons) {

                    if (!visible(btn)) continue;

                    const text = clean(btn.innerText);

                    if (text.includes(DROPDOWN_LABEL)) {
                        return btn;
                    }
                }

                return null;
            }

            // ==========================================================
            // CHECK ANY TARGET ALREADY SELECTED
            // ==========================================================

            function isSelected() {

                const dropdown = findDropdown();

                if (!dropdown) return false;

                const text = norm(dropdown.innerText);

                return TARGETS.some(target => text.includes(norm(target)));
            }

            // ==========================================================
            // FIND CENTER OPTION (TARGETS-এর ক্রম অনুযায়ী)
            // ==========================================================

            function findJFPOption() {

                const dropdown = findDropdown();

                const candidates = [];

                document
                    .querySelectorAll('button, [role="option"], [role="menuitem"], li, div, span, a')
                    .forEach(el => {

                        if (!visible(el)) return;

                        // Dropdown button নিজে বা তার parent যেন option না হয়
                        if (dropdown && (el === dropdown || el.contains(dropdown))) return;

                        const text = norm(el.innerText);

                        // শুধু IVAC দিয়ে শুরু হওয়া ছোট element
                        if (!text.startsWith('ivac') || text.length > 80) return;

                        candidates.push(el);
                    });

                // শুধু সবচেয়ে ভেতরের element নেব, যাতে click সঠিক জায়গায় যায়
                const leaves = candidates.filter(
                    el => !candidates.some(other => other !== el && el.contains(other))
                );

                if (!optionsLogged && leaves.length > 0) {
                    optionsLogged = true;
                    console.log(
                        '📋 পাওয়া IVAC options:',
                        leaves.map(el => norm(el.innerText))
                    );
                }

                for (const target of TARGETS) {

                    const t = norm(target);

                    const hit = leaves.find(el => norm(el.innerText).includes(t));

                    if (hit) {
                        console.log('🎯 CENTER FOUND:', target);
                        return hit;
                    }
                }

                return null;
            }

            // ==========================================================
            // FIND CONFIRM BUTTON
            // ==========================================================

            function findConfirm() {

                const buttons = document.querySelectorAll('button');

                for (const btn of buttons) {

                    if (!visible(btn)) continue;

                    const text = clean(btn.innerText);

                    if (text.includes(CONFIRM_TEXT)) {
                        return btn;
                    }
                }

                return null;
            }

            // ==========================================================
            // TRY TO FIND OPTION JUST AFTER OPENING DROPDOWN
            // ==========================================================

            function quickFindJFP() {

                let attempt = 0;
                const maxAttempts = 8;

                const timer = setInterval(() => {

                    attempt++;

                    if (isSelected()) {
                        clearInterval(timer);
                        console.log('✅ CENTER ALREADY SELECTED');
                        return;
                    }

                    const option = findJFPOption();

                    if (option) {

                        clearInterval(timer);

                        const now = Date.now();

                        if (now - lastOptionClick < 800) {
                            return;
                        }

                        lastOptionClick = now;

                        console.log('🎯 CENTER OPTION FOUND → CLICKING NOW');

                        try {
                            option.style.outline = '3px solid lime';
                        } catch (_) {}

                        hardClick(option);

                        setTimeout(() => {

                            if (isSelected()) {
                                console.log('✅ CENTER SELECTION VERIFIED');
                                tryConfirm();
                            } else {
                                console.log('⚠️ CENTER NOT SELECTED YET → MAIN WATCHER WILL RETRY');
                            }

                        }, 600);

                        return;
                    }

                    if (attempt >= maxAttempts) {
                        clearInterval(timer);
                        console.log('⏳ CENTER OPTION NOT FOUND YET → WILL RETRY');
                    }

                }, 250);
            }

            // ==========================================================
            // TRY CONFIRM
            // ==========================================================

            function tryConfirm() {

                if (!isSelected()) {
                    return false;
                }

                const confirmBtn = findConfirm();

                if (!confirmBtn) {
                    console.log('⏳ Waiting for Confirm Mission & IVAC Center button...');
                    return false;
                }

                if (confirmBtn.disabled) {
                    console.log('⏳ Confirm button found but DISABLED → WILL KEEP CHECKING');
                    return false;
                }

                const now = Date.now();

                if (now - lastConfirmClick < 3000) {
                    return false;
                }

                lastConfirmClick = now;

                console.log('🚀 CONFIRM BUTTON ACTIVE → CLICKING');

                hardClick(confirmBtn);

                return true;
            }

            // ==========================================================
            // MAIN RUN
            // ==========================================================

            function run() {

                if (!isModule2Page()) return;

                console.log('🔎 1-SECOND CHECK → SEARCHING CENTER...');

                // STEP 1: কোনো center আগে থেকে select হয়ে আছে?
                if (isSelected()) {

                    console.log('✅ CENTER ALREADY SELECTED');

                    tryConfirm();
                    return;
                }

                // STEP 2: Dropdown খোলা অবস্থায় option visible আছে?
                const option = findJFPOption();

                if (option) {

                    const now = Date.now();

                    if (now - lastOptionClick >= 800) {

                        lastOptionClick = now;

                        console.log('🎯 CENTER OPTION VISIBLE → SELECTING');

                        hardClick(option);

                        setTimeout(() => {

                            if (isSelected()) {
                                console.log('✅ CENTER SELECTED SUCCESSFULLY');
                                tryConfirm();
                            } else {
                                console.log('⚠️ SELECTION NOT VERIFIED → WILL RETRY');
                            }

                        }, 600);
                    }

                    return;
                }

                // STEP 3: Dropdown খুঁজুন
                const dropdown = findDropdown();

                if (!dropdown) {
                    console.log('⏳ IVAC CENTER DROPDOWN NOT FOUND → WILL CHECK AGAIN IN 1 SECOND');
                    return;
                }

                // STEP 4: Dropdown আগে থেকে খোলা থাকলে আবার click করবেন না
                const now = Date.now();

                if (now - lastDropdownClick < 1000) {
                    return;
                }

                if (dropdown.getAttribute('aria-expanded') === 'true') {
                    return;
                }

                lastDropdownClick = now;

                console.log('▼ IVAC CENTER DROPDOWN FOUND → OPENING');

                hardClick(dropdown);

                quickFindJFP();
            }

            // ==========================================================
            // START
            // ==========================================================

            console.log('🔎 PAGE OPEN → IMMEDIATE FIRST CHECK');

            run();

            setInterval(() => {
                try {
                    run();
                } catch (error) {
                    console.error('❌ CENTER AUTO ERROR:', error);
                }
            }, CHECK_INTERVAL);

            console.log('✅ ALWAYS WATCHING MODE ACTIVE');
            console.log('✅ CENTERS:', TARGETS);

        })();
    } catch (error) {
        console.error('[IVAC MASTER] MODULE 2 START ERROR:', error);
    }

    // ================================================================
    // MODULE 3 — SAVE & CONTINUE
    // ================================================================
    try {
        (function () {
            'use strict';

            const CHECK_INTERVAL = 1000;

            function isModule3Page() {
                const path = location.pathname.replace(/\/+$/, '') || '/';
                return path === '/appointment/file-upload';
            }

            function cleanText(text) {
                return (text || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();
            }

            function isVisible(element) {
                if (!element) return false;

                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);

                return (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0'
                );
            }

            function checkAndClickSaveContinue() {

                if (!isModule3Page()) return;

                console.log('[AUTO] 🔍 Save & Continue খোঁজা হচ্ছে...');

                const buttons = document.querySelectorAll('button');

                let found = false;

                for (const button of buttons) {

                    const text = cleanText(button.innerText || button.textContent);

                    if (
                        text.includes('save & continue') &&
                        !button.disabled &&
                        button.getAttribute('aria-disabled') !== 'true' &&
                        isVisible(button)
                    ) {

                        found = true;

                        console.log('[AUTO] ✅ Save & Continue পাওয়া গেছে — CLICK', button);

                        try {
                            button.focus();
                            button.click();
                        } catch (error) {
                            console.log('[AUTO] ❌ Click error:', error);
                        }
                    }
                }

                if (!found) {
                    console.log('[AUTO] ⏳ Save & Continue এখনো পাওয়া যায়নি — 1 second পর আবার খুঁজবে');
                }
            }

            checkAndClickSaveContinue();

            setInterval(function () {
                checkAndClickSaveContinue();
            }, CHECK_INTERVAL);

        })();
    } catch (error) {
        console.error('[IVAC MASTER] MODULE 3 START ERROR:', error);
    }

})();







//-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------


/*
// ==UserScript==
// @name         IVAC Server Open Detector reaload
// @namespace    ivac-auto-hard-reload
// @version      1.5.0
// @description  Auto reload until "Forgot Password?" is found + independent 5-minute server-error keyword monitor.
// @match        https://appointment.ivacbd.com/*
// @match        https://www.appointment.ivacbd.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==*/

(function () {
    'use strict';

    // =====================================================
    // SETTINGS
    // =====================================================

    const TARGET_TEXT = 'Forgot Password?';

    const ENABLE_KEY = 'IVAC_AUTO_RELOAD_ENABLED';
    const SECOND_KEY = 'IVAC_AUTO_RELOAD_SECONDS';
    const PANEL_KEY  = 'IVAC_AUTO_RELOAD_PANEL_VISIBLE';

    // Independent error monitor settings
    const ERROR_ENABLE_KEY   = 'IVAC_ERROR_MONITOR_ENABLED';
    const ERROR_KEYWORDS_KEY = 'IVAC_ERROR_MONITOR_KEYWORDS';
    const ERROR_DEFAULT_KEYWORDS = 'Something went wrong\nError Loading';
    const ERROR_CHECK_MS = 5000;          // check every 5 seconds
    const ERROR_MONITOR_MS = 5 * 60 * 1000; // monitor each loaded page for 5 minutes
    const ERROR_WAIT_KEY = 'IVAC_ERROR_RELOAD_WAIT_MINUTES';
    let errorWaitMinutes = parseFloat(localStorage.getItem(ERROR_WAIT_KEY));
    if (!Number.isFinite(errorWaitMinutes) || errorWaitMinutes < 0.5) errorWaitMinutes = 3;
    let ERROR_RELOAD_WAIT_MS = errorWaitMinutes * 60 * 1000;
    const ERROR_GATE_KEY = 'IVAC_ERROR_RELOAD_GATE_V12';
    let errorGate = null;
    try { errorGate = JSON.parse(sessionStorage.getItem(ERROR_GATE_KEY) || 'null'); } catch (_) {}
    if (!errorGate || !Number.isFinite(errorGate.at)) errorGate = null;
    let errorGateTimer = null;
    // Display-only identity for this document's userscript run.
    const INSTANCE_COUNT_KEY = 'IVAC_RELOAD_INSTANCE_COUNT';
    const INSTANCE_STATUS_MS = 2 * 60 * 1000;
    const instanceStartedAt = Date.now();
    const instanceAfterErrorReload = Boolean(errorGate && errorGate.phase === 'waiting_new_document');
    const previousInstanceCount = Number(sessionStorage.getItem(INSTANCE_COUNT_KEY)) || 0;
    const instanceCount = previousInstanceCount + 1;
    sessionStorage.setItem(INSTANCE_COUNT_KEY, String(instanceCount));
    let instanceStatusShownAt = 0;



    let errorMonitorEnabled = localStorage.getItem(ERROR_ENABLE_KEY);
    if (errorMonitorEnabled === null) {
        errorMonitorEnabled = true;
        localStorage.setItem(ERROR_ENABLE_KEY, 'true');
    } else {
        errorMonitorEnabled = errorMonitorEnabled === 'true';
    }

    let errorKeywords = localStorage.getItem(ERROR_KEYWORDS_KEY) || ERROR_DEFAULT_KEYWORDS;
    let errorMonitorTimer = null;
    let errorMonitorStopTimer = null;
    let errorReloadTriggered = false;
    let errorMonitorStartedAt = 0;

    let enabled = localStorage.getItem(ENABLE_KEY);

    // First time script runs = OFF
    if (enabled === null) {
        enabled = false;
        localStorage.setItem(ENABLE_KEY, 'false');
    } else {
        enabled = enabled === 'true';
    }

    let reloadSeconds =
        parseFloat(localStorage.getItem(SECOND_KEY)) || 10;

    let panelVisible =
        localStorage.getItem(PANEL_KEY) !== 'false';

    let reloadTimer = null;
    let searchTimer = null;
    // =====================================================
    // TEXT FINDER
    // =====================================================

    function targetFound() {
        const link = document.querySelector('a[href="/forget-password"]');
        if (!link) return false;

        return link.textContent
            .trim()
            .toLowerCase() === TARGET_TEXT.toLowerCase();
    }

    // =====================================================
    // STOP WHEN SERVER OPEN
    // =====================================================

    function serverOpen() {

        enabled = false;

        localStorage.setItem(ENABLE_KEY, 'false');

        clearTimeout(reloadTimer);
        clearInterval(searchTimer);

        reloadTimer = null;
        searchTimer = null;

        updatePanel();

        console.log(
            '[IVAC Auto Reload] Server Open → Auto Reload STOPPED'
        );
    }

    // =====================================================
    // HARD RELOAD
    // =====================================================

    function hardReload() {

        if (!enabled) return;

        // Check one final time before reload
        if (targetFound()) {
            serverOpen();
            return;
        }

        console.log('[IVAC Auto Reload] Reloading...');

        /*
         * JavaScript cannot force Chrome's exact
         * Ctrl+Shift+R cache-bypass behavior.
         *
         * location.reload() is the safest reload method
         * without changing the website URL.
         */

        window.location.reload();
    }

    // =====================================================
    // START AUTO RELOAD
    // =====================================================

    function startReload() {

        clearTimeout(reloadTimer);
        clearInterval(searchTimer);

        if (!enabled) {
            updatePanel();
            return;
        }

        // Immediately check
        if (targetFound()) {
            serverOpen();
            return;
        }

        updatePanel();

        // -------------------------------------------------
        // CONTINUOUSLY SEARCH FOR "Forgot Password?"
        // -------------------------------------------------

        searchTimer = setInterval(() => {

            if (!enabled) return;

            if (targetFound()) {
                serverOpen();
            }

        }, 1000);

        // -------------------------------------------------
        // RELOAD TIMER
        // -------------------------------------------------

        reloadTimer = setTimeout(() => {

            if (!enabled) return;

            if (targetFound()) {
                serverOpen();
                return;
            }

            hardReload();

        }, reloadSeconds * 1000);
    }

    // =====================================================
    // INDEPENDENT ERROR MONITOR
    // =====================================================

    function getErrorKeywordList() {
        return String(errorKeywords || '')
            .split(/\r?\n/)
            .map(v => v.trim())
            .filter(Boolean);
    }

    function findErrorKeyword() {
        if (!document.body) return null;

        const pageText = (document.body.innerText || document.body.textContent || '')
            .replace(/\s+/g, ' ')
            .toLowerCase();

        const list = getErrorKeywordList();
        for (const keyword of list) {
            if (pageText.includes(keyword.toLowerCase())) return keyword;
        }
        return null;
    }

    function stopErrorMonitor() {
        clearInterval(errorMonitorTimer);
        clearTimeout(errorMonitorStopTimer);
        errorMonitorTimer = null;
        errorMonitorStopTimer = null;
        updateErrorMonitorPanel();
    }

    function saveErrorGate() {
        if (errorGate) sessionStorage.setItem(ERROR_GATE_KEY, JSON.stringify(errorGate));
        else sessionStorage.removeItem(ERROR_GATE_KEY);
    }

    function triggerErrorReload(keyword) {
        if (!errorMonitorEnabled || errorReloadTriggered) return;
        if (errorGate && errorGate.phase !== 'monitor_new_document') return;
        // Block further error reloads in this document, including if navigation stalls.
        errorReloadTriggered = true;
        stopErrorMonitor();
        errorGate = { at: Date.now(), phase: 'waiting_new_document' };
        saveErrorGate();
        updateErrorMonitorPanel('ERROR FOUND → RELOADING');
        console.log('[IVAC Error Monitor] Found:', keyword, '→ ONE reload');
        window.location.reload();
    }

    function checkErrorKeywords() {
        if (!errorMonitorEnabled || errorReloadTriggered) return;
        if (errorGate && errorGate.phase !== 'monitor_new_document') return;
        const found = findErrorKeyword();
        if (found) triggerErrorReload(found);
    }

    function startErrorMonitor() {
        stopErrorMonitor();
        if (errorReloadTriggered) return;
        if (errorGate && errorGate.phase !== 'monitor_new_document') return;
        if (errorGate && Date.now() < errorGate.at + ERROR_RELOAD_WAIT_MS) return;
        if (!errorMonitorEnabled) {
            updateErrorMonitorPanel();
            return;
        }
        errorMonitorStartedAt = Date.now();
        updateErrorMonitorPanel();
        checkErrorKeywords();
        if (errorReloadTriggered) return;
        errorMonitorTimer = setInterval(checkErrorKeywords, ERROR_CHECK_MS);
        errorMonitorStopTimer = setTimeout(() => {
            clearInterval(errorMonitorTimer);
            errorMonitorTimer = null;
            if (errorGate && errorGate.phase === 'monitor_new_document') {
                errorGate.phase = 'await_next_document';
                saveErrorGate();
                updateErrorMonitorPanel('WAITING FOR NEXT PAGE');
            } else {
                updateErrorMonitorPanel('5 MIN COMPLETE');
            }
        }, ERROR_MONITOR_MS);
    }

    function scheduleErrorGateStart() {
        if (errorGateTimer !== null) clearTimeout(errorGateTimer);
        const waitMs = Math.max(0, errorGate.at + ERROR_RELOAD_WAIT_MS - Date.now());
        errorGateTimer = setTimeout(() => {
            errorGateTimer = null;
            startErrorMonitor();
        }, waitMs);
    }

    function restoreErrorGateOnNewDocument() {
        if (!errorGate) {
            startErrorMonitor();
            return;
        }
        // Reaching this function means a new document has executed the script.
        if (errorGate.phase === 'waiting_new_document' ||
            errorGate.phase === 'await_next_document' ||
            errorGate.phase === 'monitor_new_document') {
            errorGate.phase = 'monitor_new_document';
            saveErrorGate();
            updateErrorMonitorPanel('WAITING FOR NEW PAGE');
            scheduleErrorGateStart();
        }
    }

    // Display only: this timer never starts a monitor or reload.
    function renderErrorCountdown() {
        const display = document.getElementById('ivacErrorCountdown');
        if (!display) return;
        if (!errorGate) {
            display.style.display = 'none';
            return;
        }
        const remaining = Math.max(0, Math.ceil(
            (errorGate.at + ERROR_RELOAD_WAIT_MS - Date.now()) / 1000
        ));
        if (remaining === 0 && errorGate.phase !== 'waiting_new_document') {
            display.style.display = 'none';
            return;
        }
        display.style.display = 'block';
        display.textContent = remaining > 0
            ? 'Error reload wait: ' + remaining + ' sec left'
            : '0 sec • waiting for new page';
    }

    function updateErrorMonitorPanel(forcedStatus) {
        const status = document.getElementById('ivacErrorStatus');
        const toggle = document.getElementById('ivacErrorToggle');
        if (!status || !toggle) return;

        if (!errorMonitorEnabled) {
            status.innerText = 'ERROR MONITOR: OFF';
            status.style.background = '#374151';
            toggle.innerText = 'ON';
            toggle.style.background = '#22c55e';
        } else if (forcedStatus) {
            status.innerText = forcedStatus;
            status.style.background = '#b45309';
            toggle.innerText = 'OFF';
            toggle.style.background = '#ef4444';
        } else if (errorMonitorTimer || errorMonitorStartedAt) {
            status.innerText = 'ERROR MONITOR: ON • 5s CHECK';
            status.style.background = '#1d4ed8';
            toggle.innerText = 'OFF';
            toggle.style.background = '#ef4444';
        } else {
            status.innerText = 'ERROR MONITOR: READY';
            status.style.background = '#1d4ed8';
            toggle.innerText = 'OFF';
            toggle.style.background = '#ef4444';
        }
        toggle.style.color = '#fff';
    }

    function showInstanceStatusOnce() {
        if (instanceStatusShownAt) return;
        const badge = document.getElementById('ivacInstanceStatus');
        if (!badge) return;
        instanceStatusShownAt = Date.now();
        const time = new Date(instanceStartedAt).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        badge.textContent = '' + instanceCount + ' • ' + time +
            (instanceAfterErrorReload ? ' • AFTER ERROR RELOAD' : '');
        badge.style.display = 'block';
        setTimeout(() => { badge.style.display = 'none'; }, INSTANCE_STATUS_MS);
    }

    // =====================================================
    // PANEL
    // =====================================================

    function createPanel() {

        if (!document.body) {
            setTimeout(createPanel, 100);
            return;
        }

        if (document.getElementById('ivacReloadPanel')) return;

        const panel = document.createElement('div');

        panel.id = 'ivacReloadPanel';

        panel.innerHTML = `
            <div id="ivacReloadHeader">
                <span>RELOAD</span>
                <button id="ivacReloadClose">×</button>
            </div>

            <div id="ivacInstanceStatus" style="display:none"></div>

            <div id="ivacReloadStatus">
                Loading...
            </div>

            <div id="ivacReloadCountdown" style="display:none">
                --
            </div>

            <div class="ivacRow" style="display:none">
                <input
                    id="ivacReloadSeconds"
                    type="number"
                    min="0.5"
                    step="0.5"
                    value="${reloadSeconds}"
                >

                <span>Sec</span>
            </div>

            <button id="ivacReloadToggle">
                --
            </button>

            <div id="ivacErrorBox" style="display:none">
                <div id="ivacErrorTitle">ERROR MONITOR</div>
                <textarea id="ivacErrorKeywords" spellcheck="false">${errorKeywords}</textarea>
                <div class="ivacErrorRow">
                    <button id="ivacSaveErrorKeywords">SAVE KEYWORDS</button>
                    <button id="ivacErrorToggle">--</button>
                </div>
                <div class="ivacRow ivacErrorWaitRow">
                    <label for="ivacErrorWaitMinutes">Reload wait</label>
                    <input id="ivacErrorWaitMinutes" type="number" min="0.5" step="0.5" value="${errorWaitMinutes}">
                    <span>Min</span>
                </div>
                <div id="ivacErrorStatus">--</div>
                <div id="ivacErrorCountdown" aria-live="off"></div>
                <div id="ivacErrorHint">Every 5 sec • Max 5 min • Match contains text • One reload only</div>
            </div>
        `;

        const style = document.createElement('style');

        style.textContent = `

            #ivacReloadPanel {
                position: fixed;
                top: 15px;
                left: 15px;
                width: 90px;
                background: #111827;
                color: white;
                border-radius: 12px;
                padding: 5px;
                font-family: Arial, sans-serif;
                z-index: 2147483647;
                box-shadow: 0 5px 20px rgba(0,0,0,.35);
                border: 1px solid rgba(255,255,255,.15);
            }

            #ivacReloadHeader {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 9px;
                font-weight: 700;
                margin-bottom: 10px;
            }

            #ivacReloadClose {
                width: 20px;
                height: 20px;
                border: none;
                border-radius: 50%;
                background: #ef4444;
                color: white;
                cursor: pointer;
                font-size: 12px;
                line-height: 20px;
                padding: 0;
            }

            #ivacInstanceStatus {
                padding: 6px 5px;
                margin-bottom: 8px;
                border-radius: 6px;
                background: #1d4ed8;
                color: #fff;
                text-align: center;
                font-size: 9px;
                font-weight: 700;
                line-height: 1.4;
            }

            #ivacReloadStatus {
                text-align: center;
                padding: 6px 5px;
                border-radius: 7px;
                margin-bottom: 7px;
                font-size: 9px;
                font-weight: 700;
            }

            #ivacReloadCountdown {
                text-align: center;
                font-size: 9px;
                color: #d1d5db;
                margin-bottom: 10px;
            }

            .ivacRow {
                display: flex;
                align-items: center;
                gap: 5px;
                margin-bottom: 5px;
            }

            #ivacReloadSeconds {
                width: 65px;
                font-size: 12px;
                padding: 5px;
                border: none;
                border-radius: 6px;
                outline: none;
                text-align: center;
                font-weight: bold;
                color: #111;
                background: white;
            }


            #ivacReloadToggle {
                width: 100%;
                border: none;
                border-radius: 7px;
                padding: 5px;
                font-weight: 700;
                cursor: pointer;
                font-size: 9px;
            }

            #ivacErrorBox {
                margin-top: 10px;
                padding-top: 10px;
                border-top: 1px solid rgba(255,255,255,.18);
            }

            #ivacErrorTitle {
                font-size: 12px;
                font-weight: 700;
                margin-bottom: 6px;
            }

            #ivacErrorKeywords {
                width: 100%;
                height: 58px;
                box-sizing: border-box;
                resize: vertical;
                border: none;
                border-radius: 6px;
                padding: 7px;
                outline: none;
                font-family: Arial, sans-serif;
                font-size: 12px;
                color: #111;
                background: white;
                margin-bottom: 6px;
            }

            .ivacErrorRow {
                display: flex;
                gap: 5px;
                margin-bottom: 6px;
            }

            #ivacSaveErrorKeywords,
            #ivacErrorToggle {
                border: none;
                border-radius: 6px;
                padding: 7px;
                color: white;
                cursor: pointer;
                font-weight: 700;
                font-size: 11px;
            }

            #ivacSaveErrorKeywords { flex: 1; background: #2563eb; }
            #ivacErrorToggle { width: 55px; }

            .ivacErrorWaitRow { font-size: 11px; }
            .ivacErrorWaitRow label { flex: 1; }
            #ivacErrorWaitMinutes {
                width: 60px;
                box-sizing: border-box;
                padding: 6px;
                border: 0;
                border-radius: 6px;
                text-align: center;
                font-weight: bold;
            }

            #ivacErrorStatus {
                text-align: center;
                border-radius: 6px;
                padding: 6px 4px;
                font-size: 11px;
                font-weight: 700;
                margin-bottom: 5px;
            }

            #ivacErrorCountdown {
                text-align: center;
                color: #facc15;
                font-size: 12px;
                font-weight: 700;
                margin: 0 0 6px;
            }

            #ivacErrorHint {
                color: #d1d5db;
                font-size: 10px;
                line-height: 1.35;
                text-align: center;
            }

            #ivacReloadMini {
                position: fixed;
                top: 15px;
                left: 15px;
                z-index: 2147483647;
                width: 42px;
                height: 42px;
                border: none;
                border-radius: 50%;
                background: #ff0000;
                color: white;
                font-size: 30px;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(0,0,0,.35);
            }

        `;

        document.head.appendChild(style);
        document.body.appendChild(panel);

        // =================================================
        // TOGGLE
        // =================================================

        document
            .getElementById('ivacReloadToggle')
            .addEventListener('click', function () {

                enabled = !enabled;

                localStorage.setItem(
                    ENABLE_KEY,
                    enabled ? 'true' : 'false'
                );

                if (enabled) {

                    // Manual ON
                    startReload();

                } else {

                    clearTimeout(reloadTimer);
                    clearInterval(searchTimer);

                    reloadTimer = null;
                    searchTimer = null;

                    updatePanel();
                }
            });

        // =================================================
        // AUTO-SAVE SECONDS (same reload timing as the former SAVE button)
        // =================================================
        const secondsInput = document.getElementById('ivacReloadSeconds');
        secondsInput.addEventListener('input', function () {
            const value = parseFloat(secondsInput.value);
            if (!Number.isFinite(value) || value < 0.5) return;
            reloadSeconds = value;
            localStorage.setItem(SECOND_KEY, String(value));
        });
        secondsInput.addEventListener('change', function () {
            if (!Number.isFinite(parseFloat(secondsInput.value)) || parseFloat(secondsInput.value) < 0.5) {
                secondsInput.value = reloadSeconds;
            }
            if (enabled) startReload();
            updatePanel();
        });

        // =================================================
        // AUTO-SAVE ERROR RELOAD WAIT
        // =================================================
        const waitInput = document.getElementById('ivacErrorWaitMinutes');
        waitInput.addEventListener('input', function () {
            const value = parseFloat(waitInput.value);
            if (!Number.isFinite(value) || value < 0.5) return;
            errorWaitMinutes = value;
            ERROR_RELOAD_WAIT_MS = value * 60 * 1000;
            localStorage.setItem(ERROR_WAIT_KEY, String(value));
            renderErrorCountdown();
            if (errorGate && errorGate.phase === 'monitor_new_document' && errorGateTimer !== null) {
                scheduleErrorGateStart();
            }
        });
        waitInput.addEventListener('change', function () {
            if (!Number.isFinite(parseFloat(waitInput.value)) || parseFloat(waitInput.value) < 0.5) {
                waitInput.value = errorWaitMinutes;
            }
        });

        // =================================================
        // ERROR MONITOR CONTROLS
        // =================================================

        document.getElementById('ivacSaveErrorKeywords').addEventListener('click', function () {
            const input = document.getElementById('ivacErrorKeywords');
            errorKeywords = input.value.trim() || ERROR_DEFAULT_KEYWORDS;
            input.value = errorKeywords;
            localStorage.setItem(ERROR_KEYWORDS_KEY, errorKeywords);
            if (errorMonitorEnabled) startErrorMonitor();
        });

        document.getElementById('ivacErrorToggle').addEventListener('click', function () {
            errorMonitorEnabled = !errorMonitorEnabled;
            localStorage.setItem(ERROR_ENABLE_KEY, errorMonitorEnabled ? 'true' : 'false');

            if (errorMonitorEnabled) {
                startErrorMonitor();
            } else {
                errorReloadTriggered = false;
                errorMonitorStartedAt = 0;
                stopErrorMonitor();
            }
            updateErrorMonitorPanel();
        });

        // =================================================
        // CLOSE PANEL
        // =================================================

        document
            .getElementById('ivacReloadClose')
            .addEventListener('click', function () {

                panel.style.display = 'none';

                localStorage.setItem(
                    PANEL_KEY,
                    'false'
                );

                createMiniButton();
            });

        if (!panelVisible) {
            panel.style.display = 'none';
            createMiniButton();
        } else {
            showInstanceStatusOnce();
        }

        updatePanel();
        updateErrorMonitorPanel();
        renderErrorCountdown();
        setInterval(renderErrorCountdown, 1000);
    }

    // =====================================================
    // MINI BUTTON AFTER CLOSE
    // =====================================================

    function createMiniButton() {

        if (document.getElementById('ivacReloadMini')) return;

        const mini = document.createElement('button');

        mini.id = 'ivacReloadMini';
        mini.innerHTML = '↻';
        mini.title = 'Open Auto Reload Panel';

        document.body.appendChild(mini);

        mini.addEventListener('click', function () {

            const panel =
                document.getElementById('ivacReloadPanel');

            if (panel) {
                panel.style.display = 'block';
                showInstanceStatusOnce();
            }

            mini.remove();

            panelVisible = true;

            localStorage.setItem(
                PANEL_KEY,
                'true'
            );
        });
    }

    // =====================================================
    // UPDATE PANEL
    // =====================================================

    function updatePanel() {

        const status =
            document.getElementById('ivacReloadStatus');

        const toggle =
            document.getElementById('ivacReloadToggle');

        const countdown =
            document.getElementById('ivacReloadCountdown');

        if (!status || !toggle || !countdown) return;

        if (!enabled) {

            status.innerText = 'SERVER OPEN';
            status.style.background = '#16a34a';

            toggle.innerText = 'ON';
            toggle.style.background = '#22c55e';
            toggle.style.color = '#fff';


            countdown.innerText =
                '';

        } else {

            status.innerText = 'SEARCHING...';
            status.style.background = '#dc2626';

            toggle.innerText = 'OFF';
            toggle.style.background = '#ef4444';
            toggle.style.color = '#fff';

            countdown.innerText =
                'Reload interval: ' +
                reloadSeconds +
                ' sec';
        }
    }

    // =====================================================
    // INITIAL START
    // =====================================================

    function init() {

        createPanel();
        restoreErrorGateOnNewDocument();

        // Immediately check page
        if (targetFound()) {

            serverOpen();

        } else if (enabled) {

            startReload();
        }
    }

    if (document.readyState === 'loading') {

        document.addEventListener(
            'DOMContentLoaded',
            init,
            { once: true }
        );

    } else {

        init();
    }

})();
