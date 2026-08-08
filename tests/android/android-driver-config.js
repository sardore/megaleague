export const ANDROID_PACKAGE=process.env.CP32_ANDROID_PACKAGE||'com.android.chrome';
export const ANDROID_ACTIVITY=process.env.CP32_ANDROID_ACTIVITY||'com.google.android.apps.chrome.Main';
export const ADB=process.env.ADB||'adb';
export const VIEWPORT={width:412,height:915};
export const CASES={short:Number(process.env.CP32_ANDROID_SHORT_CASES||5),long:Number(process.env.CP32_ANDROID_LONG_CASES||3),offline:Number(process.env.CP32_ANDROID_OFFLINE_CASES||2)};
