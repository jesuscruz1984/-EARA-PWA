plugins {
    id("com.android.application")
}

android {
    namespace = "com.eara.ai"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.eara.ai"
        minSdk = 26
        targetSdk = 36
        versionCode = 26
        versionName = "26.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
