#import "EARAGlassesBridge.h"
#import <CoreBluetooth/CoreBluetooth.h>
#import "QCCentralManager.h"
#import <QCSDK/QCSDKCmdCreator.h>

@interface EARAGlassesBridge () <QCCentralManagerDelegate>
@property (nonatomic, assign, readwrite) BOOL connected;
@property (nonatomic, copy, readwrite) NSString *statusText;
@property (nonatomic, assign) BOOL tryingToConnect;
@end

@implementation EARAGlassesBridge

- (instancetype)init {
    self = [super init];
    if (self) {
        _statusText = @"Ready";
        [QCCentralManager shared].delegate = self;
    }
    return self;
}

- (void)emit:(NSString *)type extra:(NSDictionary *)extra {
    NSMutableDictionary *payload = [@{ @"type": type ?: @"status",
                                      @"connected": @(self.connected),
                                      @"status": self.statusText ?: @"" } mutableCopy];
    if (extra) [payload addEntriesFromDictionary:extra];
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.eventHandler) self.eventHandler(payload);
    });
}

- (void)startAutoConnect {
    [QCCentralManager shared].delegate = self;
    if ([QCCentralManager shared].deviceState == QCStateConnected) {
        self.connected = YES;
        self.statusText = [QCCentralManager shared].connectedPeripheral.name ?: @"W610 connected";
        [self emit:@"connected" extra:nil];
        return;
    }
    self.tryingToConnect = YES;
    self.statusText = @"Scanning for W610…";
    [self emit:@"scanning" extra:nil];
    [[QCCentralManager shared] scan];
}

- (void)disconnect {
    self.tryingToConnect = NO;
    [[QCCentralManager shared] stopScan];
    [[QCCentralManager shared] remove];
    self.connected = NO;
    self.statusText = @"Disconnected";
    [self emit:@"disconnected" extra:nil];
}

- (void)takePhoto {
    if ([QCCentralManager shared].deviceState != QCStateConnected) {
        self.statusText = @"Connect W610 before taking a photo";
        [self emit:@"error" extra:@{ @"action": @"takePhoto" }];
        return;
    }
    self.statusText = @"Taking photo…";
    [self emit:@"photo-start" extra:nil];
    [QCSDKCmdCreator setDeviceMode:QCOperatorDeviceModePhoto success:^{
        self.statusText = @"Photo command accepted by W610";
        [self emit:@"photo-taken" extra:nil];
    } fail:^(NSInteger mode) {
        self.statusText = [NSString stringWithFormat:@"Photo command failed (mode %ld)", (long)mode];
        [self emit:@"error" extra:@{ @"action": @"takePhoto", @"mode": @(mode) }];
    }];
}

- (void)requestBattery {
    if ([QCCentralManager shared].deviceState != QCStateConnected) {
        self.statusText = @"W610 is not connected";
        [self emit:@"error" extra:@{ @"action": @"battery" }];
        return;
    }
    [QCSDKCmdCreator getDeviceBattery:^(NSInteger battery, BOOL charging) {
        self.statusText = [NSString stringWithFormat:@"Battery %ld%%%@", (long)battery, charging ? @" • charging" : @""];
        [self emit:@"battery" extra:@{ @"battery": @(battery), @"charging": @(charging) }];
    } fail:^{
        self.statusText = @"Could not read W610 battery";
        [self emit:@"error" extra:@{ @"action": @"battery" }];
    }];
}

#pragma mark - QCCentralManagerDelegate

- (void)didScanPeripherals:(NSArray<QCBlePeripheral *> *)peripheralArr {
    if (!self.tryingToConnect) return;

    for (QCBlePeripheral *candidate in peripheralArr) {
        CBPeripheral *peripheral = candidate.peripheral;
        NSString *name = peripheral.name ?: @"";
        if ([name.uppercaseString hasPrefix:@"W610"]) {
            self.tryingToConnect = NO;
            [[QCCentralManager shared] stopScan];
            self.statusText = [NSString stringWithFormat:@"Connecting to %@…", name];
            [self emit:@"connecting" extra:@{ @"name": name, @"mac": candidate.mac ?: @"" }];
            [[QCCentralManager shared] connect:peripheral deviceType:QCDeviceTypeGlasses];
            break;
        }
    }
}

- (void)didState:(QCState)state {
    switch (state) {
        case QCStateConnected: {
            self.connected = YES;
            NSString *name = [QCCentralManager shared].connectedPeripheral.name ?: @"W610";
            self.statusText = [NSString stringWithFormat:@"%@ connected", name];
            [self emit:@"connected" extra:@{ @"name": name }];
            break;
        }
        case QCStateConnecting:
            self.connected = NO;
            self.statusText = @"Connecting…";
            [self emit:@"connecting" extra:nil];
            break;
        case QCStateDisconnecting:
        case QCStateDisconnected:
        case QCStateUnbind:
            self.connected = NO;
            self.statusText = @"Disconnected";
            [self emit:@"disconnected" extra:nil];
            break;
        case QCStateUnkown:
        default:
            break;
    }
}

- (void)didFailConnected:(CBPeripheral *)peripheral error:(NSError *)error {
    self.connected = NO;
    self.statusText = error.localizedDescription.length ? error.localizedDescription : @"Could not connect to W610";
    [self emit:@"error" extra:@{ @"action": @"connect", @"name": peripheral.name ?: @"W610" }];
}

- (void)didBluetoothState:(QCBluetoothState)state {
    [self emit:@"bluetooth" extra:@{ @"state": @(state) }];
}

@end
