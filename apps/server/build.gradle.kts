plugins {
    kotlin("jvm") version "2.2.21"
    application
}

group = "com.weshop"
version = "1.0.0"

application {
    mainClass.set("com.weshop.server.ApplicationKt")
}

repositories {
    mavenCentral()
}

kotlin {
    compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_24)
}

java {
    sourceCompatibility = JavaVersion.VERSION_24
    targetCompatibility = JavaVersion.VERSION_24
}

dependencies {
    implementation("io.ktor:ktor-server-core:3.0.0")
    implementation("io.ktor:ktor-server-netty:3.0.0")
    implementation("io.ktor:ktor-server-content-negotiation:3.0.0")
    implementation("io.ktor:ktor-serialization-kotlinx-json:3.0.0")
    testImplementation(kotlin("test"))
}
