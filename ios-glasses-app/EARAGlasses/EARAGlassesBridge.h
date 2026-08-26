#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^EARAGlassesEventHandler)(NSDictionary *event);

@interface EARAGlassesBridge : NSObject
@property (nonatomic, copy, nullable) EARAGlassesEventHandler eventHandler;
@property (nonatomic, readonly) BOOL connected;
@property (nonatomic, copy, readonly) NSString *statusText;

- (void)startAutoConnect;
- (void)disconnect;
- (void)takePhoto;
- (void)requestBattery;
@end

NS_ASSUME_NONNULL_END
