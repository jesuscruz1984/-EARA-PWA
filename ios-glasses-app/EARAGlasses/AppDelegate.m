#import "AppDelegate.h"
#import "EARARootViewController.h"

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    EARARootViewController *root = [[EARARootViewController alloc] init];
    self.window.rootViewController = root;
    [self.window makeKeyAndVisible];
    return YES;
}

@end
