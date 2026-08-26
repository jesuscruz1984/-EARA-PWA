#import "EARARootViewController.h"
#import <WebKit/WebKit.h>
#import "EARAGlassesBridge.h"

@interface EARARootViewController () <WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate>
@property (nonatomic, strong) WKWebView *webView;
@property (nonatomic, strong) EARAGlassesBridge *glasses;
@property (nonatomic, strong) UILabel *statusLabel;
@property (nonatomic, strong) UIButton *connectButton;
@property (nonatomic, strong) UIButton *photoButton;
@property (nonatomic, strong) UIButton *batteryButton;
@end

@implementation EARARootViewController

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.blackColor;

    self.glasses = [[EARAGlassesBridge alloc] init];
    __weak typeof(self) weakSelf = self;
    self.glasses.eventHandler = ^(NSDictionary *event) {
        [weakSelf handleGlassesEvent:event];
    };

    [self buildNativeBar];
    [self buildWebView];
    [self.glasses startAutoConnect];
}

- (void)buildNativeBar {
    UIView *bar = [[UIView alloc] init];
    bar.translatesAutoresizingMaskIntoConstraints = NO;
    bar.backgroundColor = [UIColor colorWithRed:0.02 green:0.06 blue:0.11 alpha:1.0];
    [self.view addSubview:bar];

    self.statusLabel = [[UILabel alloc] init];
    self.statusLabel.translatesAutoresizingMaskIntoConstraints = NO;
    self.statusLabel.text = @"EARA Glasses • starting";
    self.statusLabel.textColor = UIColor.whiteColor;
    self.statusLabel.font = [UIFont systemFontOfSize:13 weight:UIFontWeightSemibold];
    self.statusLabel.numberOfLines = 2;

    self.connectButton = [self nativeButton:@"Connect" action:@selector(connectTapped)];
    self.photoButton = [self nativeButton:@"Photo" action:@selector(photoTapped)];
    self.batteryButton = [self nativeButton:@"Battery" action:@selector(batteryTapped)];

    UIStackView *buttons = [[UIStackView alloc] initWithArrangedSubviews:@[self.connectButton, self.photoButton, self.batteryButton]];
    buttons.translatesAutoresizingMaskIntoConstraints = NO;
    buttons.axis = UILayoutConstraintAxisHorizontal;
    buttons.spacing = 6;
    buttons.distribution = UIStackViewDistributionFillEqually;

    [bar addSubview:self.statusLabel];
    [bar addSubview:buttons];

    UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [bar.topAnchor constraintEqualToAnchor:self.view.topAnchor],
        [bar.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [bar.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [bar.bottomAnchor constraintEqualToAnchor:buttons.bottomAnchor constant:8],

        [self.statusLabel.topAnchor constraintEqualToAnchor:safe.topAnchor constant:5],
        [self.statusLabel.leadingAnchor constraintEqualToAnchor:bar.leadingAnchor constant:12],
        [self.statusLabel.trailingAnchor constraintEqualToAnchor:bar.trailingAnchor constant:-12],

        [buttons.topAnchor constraintEqualToAnchor:self.statusLabel.bottomAnchor constant:6],
        [buttons.leadingAnchor constraintEqualToAnchor:bar.leadingAnchor constant:10],
        [buttons.trailingAnchor constraintEqualToAnchor:bar.trailingAnchor constant:-10],
        [buttons.heightAnchor constraintEqualToConstant:36]
    ]];

    bar.tag = 9001;
}

- (UIButton *)nativeButton:(NSString *)title action:(SEL)action {
    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    button.translatesAutoresizingMaskIntoConstraints = NO;
    [button setTitle:title forState:UIControlStateNormal];
    [button setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    button.titleLabel.font = [UIFont systemFontOfSize:13 weight:UIFontWeightBold];
    button.backgroundColor = [UIColor colorWithRed:0.07 green:0.18 blue:0.29 alpha:1.0];
    button.layer.cornerRadius = 9;
    button.layer.borderWidth = 1;
    button.layer.borderColor = [UIColor colorWithRed:0.18 green:0.45 blue:0.62 alpha:1.0].CGColor;
    [button addTarget:self action:action forControlEvents:UIControlEventTouchUpInside];
    return button;
}

- (void)buildWebView {
    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.allowsInlineMediaPlayback = YES;
    if (@available(iOS 10.0, *)) {
        config.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    }

    WKUserContentController *controller = [[WKUserContentController alloc] init];
    [controller addScriptMessageHandler:self name:@"earaGlasses"];

    NSString *bridgeJS = @"window.EARAGlassesNative={available:true,connect:function(){window.webkit.messageHandlers.earaGlasses.postMessage({action:'connect'});},disconnect:function(){window.webkit.messageHandlers.earaGlasses.postMessage({action:'disconnect'});},takePhoto:function(){window.webkit.messageHandlers.earaGlasses.postMessage({action:'takePhoto'});},battery:function(){window.webkit.messageHandlers.earaGlasses.postMessage({action:'battery'});}};window.dispatchEvent(new CustomEvent('eara-glasses-ready'));";
    WKUserScript *script = [[WKUserScript alloc] initWithSource:bridgeJS injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES];
    [controller addUserScript:script];
    config.userContentController = controller;

    self.webView = [[WKWebView alloc] initWithFrame:CGRectZero configuration:config];
    self.webView.translatesAutoresizingMaskIntoConstraints = NO;
    self.webView.navigationDelegate = self;
    self.webView.UIDelegate = self;
    self.webView.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    [self.view addSubview:self.webView];

    UIView *bar = [self.view viewWithTag:9001];
    [NSLayoutConstraint activateConstraints:@[
        [self.webView.topAnchor constraintEqualToAnchor:bar.bottomAnchor],
        [self.webView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [self.webView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [self.webView.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor]
    ]];

    NSURL *url = [NSURL URLWithString:@"https://jesuscruz1984.github.io/-EARA-PWA/"];
    [self.webView loadRequest:[NSURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:30.0]];
}

- (void)connectTapped { [self.glasses startAutoConnect]; }
- (void)photoTapped { [self.glasses takePhoto]; }
- (void)batteryTapped { [self.glasses requestBattery]; }

- (void)handleGlassesEvent:(NSDictionary *)event {
    NSString *status = event[@"status"] ?: @"";
    BOOL connected = [event[@"connected"] boolValue];
    self.statusLabel.text = [NSString stringWithFormat:@"EARA Glasses • %@", status];
    self.photoButton.enabled = connected;
    self.batteryButton.enabled = connected;

    NSError *error = nil;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:event options:0 error:&error];
    if (!jsonData || error) return;
    NSString *json = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    NSString *js = [NSString stringWithFormat:@"window.dispatchEvent(new CustomEvent('eara-glasses-event',{detail:%@}));", json];
    [self.webView evaluateJavaScript:js completionHandler:nil];
}

#pragma mark - WKScriptMessageHandler

- (void)userContentController:(WKUserContentController *)userContentController didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.name isEqualToString:@"earaGlasses"] || ![message.body isKindOfClass:NSDictionary.class]) return;
    NSString *action = ((NSDictionary *)message.body)[@"action"];
    if ([action isEqualToString:@"connect"]) [self.glasses startAutoConnect];
    else if ([action isEqualToString:@"disconnect"]) [self.glasses disconnect];
    else if ([action isEqualToString:@"takePhoto"]) [self.glasses takePhoto];
    else if ([action isEqualToString:@"battery"]) [self.glasses requestBattery];
}

#pragma mark - Web permissions

- (void)webView:(WKWebView *)webView requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin initiatedByFrame:(WKFrameInfo *)frame type:(WKMediaCaptureType)type decisionHandler:(void (^)(WKPermissionDecision decision))decisionHandler API_AVAILABLE(ios(15.0)) {
    decisionHandler(WKPermissionDecisionGrant);
}

- (void)dealloc {
    [self.webView.configuration.userContentController removeScriptMessageHandlerForName:@"earaGlasses"];
}

@end
