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
        versionCode = 31
        versionName = "31.0-runtimeverified"
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

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.9.3")
    implementation("androidx.media3:media3-exoplayer-rtsp:1.9.3")
}
