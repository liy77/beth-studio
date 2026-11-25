// Janela do Beth Studio no macOS: WebKit da Apple (WKWebView).
// WebView2 é do Windows e não entra neste arquivo.
#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <WebKit/WebKit.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void goTrayOpen(void);
void goTrayQuit(void);
void goTrayKill(void);
void goTrayInspect(void);
void bethInspect(void);

static NSWindow *bethWindow = nil;
static NSVisualEffectView *bethVibrancy = nil;
static NSView *bethGutterStrip = nil;
static NSMutableArray<NSValue *> *bethChatHoles = nil;
static NSView *bethTitleDrag = nil;
static WKWebView *bethWeb = nil;
static int bethHidden = 0;
static int bethAllowClose = 0;
static int bethAuxWindow = 0;

void bethSetAuxWindow(int on) {
	bethAuxWindow = on ? 1 : 0;
	bethAllowClose = on ? 1 : 0;
}

extern void goWindowDrag(void);

@interface BethWindowDelegate : NSObject <NSWindowDelegate>
@end

@implementation BethWindowDelegate
- (BOOL)windowShouldClose:(NSWindow *)sender {
	(void)sender;
	if (bethAllowClose) {
		// Janela auxiliar (--tasks, --sftp…): fecha de verdade e encerra o processo.
		dispatch_async(dispatch_get_main_queue(), ^{ [NSApp terminate:nil]; });
		return YES;
	}
	// Closing the Studio window hides it. The host and its terminals stay.
	[sender orderOut:nil];
	bethHidden = 1;
	return NO;
}
@end

// A faixa vazia da barra de abas chama isto. O WebView come o clique, então
// a janela não anda sozinha; performWindowDragWithEvent move como a barra
// de título faria.
// Material da Apple atrás do WebView, só na coluna da barra lateral.
// A página deixa essa coluna sem tinta (fundo transparente), então o
// material aparece e o texto da lista continua na frente, no WebView.
static CGFloat bethSidebarWidth = 0;
static NSView *bethGlassHost = nil;
static NSView *bethRowHost = nil;
static NSView *bethTipHost = nil;
static NSView *bethMenuHost = nil;
static CGFloat bethGlassPower = 0.55;
static CGFloat bethGlassAlpha = 0.7;
// Accent do tema da interface (Véu do selecionado em Ver / chat). Padrão =
// azul do VS Code Dark; a página manda R,G,B 0–255 no bethGlassTune.
static CGFloat bethAccentR = 0.0;
static CGFloat bethAccentG = 120.0 / 255.0;
static CGFloat bethAccentB = 212.0 / 255.0;
static BOOL bethGlassDark = YES;

static NSColor *bethGlassTint(BOOL selected, BOOL hover, BOOL tip) {
	CGFloat a = (0.08 + bethGlassPower * 0.9) * bethGlassAlpha;
	if (a > 0.95) a = 0.95;
	// Selecionado (Ver / chip / chat): só a tinta do accent — a página
	// não pinta bg-accent por cima (duas tinturas).
	if (selected) {
		CGFloat sa = a * 1.35;
		if (sa > 0.92) sa = 0.92;
		if (sa < 0.45) sa = 0.45;
		return [NSColor colorWithCalibratedRed:bethAccentR green:bethAccentG blue:bethAccentB alpha:sa];
	}
	if (!bethGlassDark) {
		// Tema claro: idle claro; hover escurece (véu branco sumia no claro).
		if (hover) {
			CGFloat ha = 0.10 + a * 0.14;
			if (ha > 0.22) ha = 0.22;
			return [NSColor colorWithCalibratedWhite:0.08 alpha:ha];
		}
		if (tip) return [NSColor colorWithCalibratedWhite:1.0 alpha:a * 0.7];
		return [NSColor colorWithCalibratedWhite:1.0 alpha:a * 0.55];
	}
	if (hover) return [NSColor colorWithCalibratedWhite:0.45 alpha:a];
	if (tip) return [NSColor colorWithCalibratedWhite:0.5 alpha:a * 0.85];
	return [NSColor colorWithCalibratedWhite:0.28 alpha:a];
}

/** Tinta do rótulo nativo (botões Ver, etc.): clara no tema escuro, escura no claro. */
static NSColor *bethGlassInk(BOOL selected) {
	if (selected) return [NSColor whiteColor];
	if (bethGlassDark) return [NSColor colorWithWhite:0.86 alpha:1];
	return [NSColor colorWithWhite:0.18 alpha:1];
}

@interface BethGlassPlate : NSGlassEffectView
@property (nonatomic) BOOL bethSelected;
@property (nonatomic) BOOL bethHover;
@property (nonatomic) BOOL bethTip;
- (void)bethApplyTint;
@end

static void bethRetintGlass(void) {
	void (^paint)(NSView *) = ^(NSView *host) {
		if (host == nil) return;
		for (NSView *child in host.subviews) {
			if ([child isKindOfClass:[BethGlassPlate class]]) {
				[(BethGlassPlate *)child bethApplyTint];
				continue;
			}
			if (![child isKindOfClass:[NSGlassEffectView class]]) continue;
			NSGlassEffectView *g = (NSGlassEffectView *)child;
			g.style = bethGlassPower > 0.55 ? NSGlassEffectViewStyleRegular : NSGlassEffectViewStyleClear;
			g.tintColor = bethGlassTint(NO, NO, host == bethTipHost);
		}
	};
	paint(bethGlassHost);
	paint(bethRowHost);
	paint(bethTipHost);
	paint(bethMenuHost);
}

// bethSidebarFrame: a faixa do cartão. top = base das abas (40), bottom = altura - 8
// (mesma altura da caixa do terminal; sem vão extra sob as abas).
void bethSidebarFrame(double windowHeight, double *top, double *bottom) {
	*top = 40;
	*bottom = windowHeight - 8;
}

static NSColor *bethGutterColor(void);

// O clique passa para a página. O vidro só é o efeito.
@interface BethPassView : NSView
@end
@implementation BethPassView
- (NSView *)hitTest:(NSPoint)point { (void)point; return nil; }
@end

static void bethApplySidebarHole(void) {
	if (bethVibrancy == nil || bethWindow == nil) return;
	NSView *content = bethWindow.contentView;
	CGFloat h = content.bounds.size.height;
	CGFloat w = bethSidebarWidth;
	if (w < 1) w = 0;
	if (w > content.bounds.size.width - 16) w = content.bounds.size.width - 16;
	// Cartão na faixa do terminal: 8 px da borda, topo na base das abas (40),
	// base 8 px acima do fundo — mesma altura da caixa do terminal.
	double frameTop = 0, frameBottom = 0;
	bethSidebarFrame(h, &frameTop, &frameBottom);
	// AppKit: y=0 é o fundo. O vidro fica só no cartão: 8 px da borda, 8 px
	// do terminal, topo 40 px abaixo da janela e base 8 px acima do fundo.
	// O vão em volta é a cor da topbar, não o material.
	// O material BehindWindow aparece por cima de qualquer tinta da página.
	// O cartão fica 8 px para dentro da coluna: a borda, os semáforos e o
	// vão até o terminal continuam a cor da topbar. Largura 0 não mostra
	// efeito nenhum — era o que a janela gravava em x -8.
	CGFloat glassW = 0;
	CGFloat glassH = 0;
	CGFloat glassX = -8;
	CGFloat glassY = -8;
	if (w > 16) {
		// AppKit: y=0 é o fundo. frameTop/frameBottom vêm de cima (48 e altura-8).
		glassX = 8;
		glassY = h - frameBottom;
		glassW = w - 16;
		glassH = frameBottom - frameTop;
		if (glassH < 1) glassH = 0;
	}
	bethVibrancy.frame = NSMakeRect(glassX, glassY, glassW, glassH);
	bethVibrancy.layer.cornerRadius = 12;
	bethVibrancy.layer.masksToBounds = YES;
	FILE *logf = fopen("/tmp/beth-vibrancy-frame.txt", "a");
	if (logf != NULL) {
		NSRect vf = bethVibrancy.frame;
		fprintf(logf, "glass x %.0f y %.0f w %.0f h %.0f windowH %.0f\n", vf.origin.x, vf.origin.y, vf.size.width, vf.size.height, h);
		fclose(logf);
	}
	bethVibrancy.wantsLayer = YES;
	if (bethWindow != nil) {
		NSColor *gutter = bethGutterColor();
		bethWindow.backgroundColor = gutter;
		NSView *content = bethWindow.contentView;
		if (bethGutterStrip == nil) {
			BethPassView *strip = [[BethPassView alloc] initWithFrame:NSZeroRect];
			strip.wantsLayer = YES;
			bethGutterStrip = strip;
			[content addSubview:bethGutterStrip positioned:NSWindowBelow relativeTo:bethWeb];
		}
		// Largura 0: uma faixa na coluna inteira cobriria a lista e o vão.
		// A janela fica transparente para o material BehindWindow amostrar o
		// wallpaper. A faixa opaca cobre só o vão: semáforos, 8 px da borda
		// e 8 px até o terminal. O cartão (x=8, largura w-16) fica de fora.
		bethGutterStrip.frame = NSMakeRect(0, 0, w, h);
		NSColor *strip = gutter;
		bethGutterStrip.layer.backgroundColor = strip.CGColor;
		bethWindow.backgroundColor = [NSColor clearColor];
		CAShapeLayer *hole = [CAShapeLayer layer];
		hole.frame = bethGutterStrip.bounds;
		CGMutablePathRef path = CGPathCreateMutable();
		CGPathAddRect(path, NULL, bethGutterStrip.bounds);
		if (glassW > 1 && glassH > 1) {
			// O mesmo raio do cartão (12). Um retângulo deixa o vão com
			// canto reto e o recorte não acompanha a sidebar.
			CGPathAddRoundedRect(path, NULL, CGRectMake(glassX, glassY, glassW, glassH), 12, 12);
		}
		hole.path = path;
		hole.fillRule = kCAFillRuleEvenOdd;
		CGPathRelease(path);
		bethGutterStrip.layer.mask = hole;
		[bethGutterStrip removeFromSuperview];
		[content addSubview:bethGutterStrip positioned:NSWindowBelow relativeTo:bethWeb];
	}
	// O material não pode vazar abaixo do cartão. A máscara é a própria faixa.
	CAShapeLayer *mask = [CAShapeLayer layer];
	mask.frame = bethVibrancy.bounds;
	mask.path = [NSBezierPath bezierPathWithRoundedRect:bethVibrancy.bounds xRadius:12 yRadius:12].CGPath;
	bethVibrancy.layer.mask = mask;
}

@implementation BethGlassPlate
- (NSView *)hitTest:(NSPoint)point { (void)point; return nil; }
- (void)bethApplyTint {
	self.style = bethGlassPower > 0.55 ? NSGlassEffectViewStyleRegular : NSGlassEffectViewStyleClear;
	self.tintColor = bethGlassTint(self.bethSelected, self.bethHover, self.bethTip);
}
@end

// Triângulo do balão. Girar uma placa de vidro derruba o processo.
@interface BethTipArrow : NSView
@property (nonatomic) BOOL pointsUp;
@end
@implementation BethTipArrow
- (BOOL)isFlipped { return YES; }
- (void)drawRect:(NSRect)dirty {
	(void)dirty;
	NSBezierPath *p = [NSBezierPath bezierPath];
	CGFloat w = NSWidth(self.bounds);
	CGFloat h = NSHeight(self.bounds);
	if (self.pointsUp) {
		[p moveToPoint:NSMakePoint(0, h)];
		[p curveToPoint:NSMakePoint(w * 0.57, 1) controlPoint1:NSMakePoint(w * 0.30, h) controlPoint2:NSMakePoint(w * 0.40, -2)];
		[p lineToPoint:NSMakePoint(w, h)];
	} else {
		[p moveToPoint:NSMakePoint(0, 0)];
		[p curveToPoint:NSMakePoint(w * 0.57, h - 1) controlPoint1:NSMakePoint(w * 0.30, 0) controlPoint2:NSMakePoint(w * 0.40, h + 2)];
		[p lineToPoint:NSMakePoint(w, 0)];
	}
	[p closePath];
	[[NSColor colorWithCalibratedWhite:0.24 alpha:0.96] setFill];
	[p fill];
}
- (NSView *)hitTest:(NSPoint)point { (void)point; return nil; }
@end

// SF Symbol dentro do vidro. O efeito da Apple só garante o que está no
// contentView; um ícone da página, atrás ou na frente, some ou fica coberto.
static NSImageView *bethGlassIcon(NSString *name, CGFloat side) {
	NSImage *img = [NSImage imageWithSystemSymbolName:name accessibilityDescription:nil];
	if (img == nil) return nil;
	NSImageSymbolConfiguration *cfg = [NSImageSymbolConfiguration configurationWithPointSize:13 weight:NSFontWeightRegular];
	img = [img imageWithSymbolConfiguration:cfg] ?: img;
	NSImageView *view = [NSImageView imageViewWithImage:img];
	view.contentTintColor = [NSColor labelColor];
	view.imageScaling = NSImageScaleProportionallyUpOrDown;
	CGFloat pad = MAX(0, (side - 16) / 2);
	view.frame = NSMakeRect(pad, pad, side - pad * 2, side - pad * 2);
	return view;
}

// Liquid glass nativo na frente da página, no formato de cada aba e botão.
// Atrás do WebView o efeito não atravessa a camada da página. Na frente,
// o texto da página continua visível porque o vidro é translúcido e o
// clique atravessa.
static void bethApplyGlass(NSString *body) {
	if (bethGlassHost == nil || bethWeb == nil || bethWindow == nil) return;
	if (@available(macOS 26.0, *)) {
		for (NSView *child in [bethGlassHost.subviews copy]) [child removeFromSuperview];
		[bethChatHoles removeAllObjects];
		if (bethRowHost != nil) {
			for (NSView *child in [bethRowHost.subviews copy]) [child removeFromSuperview];
		}
		if (body.length == 0) return;
		NSData *data = [body dataUsingEncoding:NSUTF8StringEncoding];
		id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
		if (![parsed isKindOfClass:[NSArray class]]) return;
		CGFloat pageH = bethWeb.bounds.size.height;
		NSInteger n = 0;
		for (id item in (NSArray *)parsed) {
			if (![item isKindOfClass:[NSDictionary class]]) continue;
			NSDictionary *r = item;
			CGFloat x = [r[@"x"] doubleValue];
			CGFloat y = [r[@"y"] doubleValue];
			CGFloat w = [r[@"w"] doubleValue];
			CGFloat h = [r[@"h"] doubleValue];
			CGFloat rad = [r[@"r"] doubleValue];
			BOOL isRow = [r[@"row"] intValue] == 1;
			// Chat selecionado passa de 110 px (cwd / na aba / fase).
			if (w < 6 || h < 4 || w > 480 || h > 200) continue;
			if (y < 0 || y > pageH) continue;
			// WKWebView mede de cima para baixo. NSView mede de baixo para
			// cima, a menos que a view seja flipped.
			CGFloat localY = bethWeb.isFlipped ? y : (pageH - y - h);
			NSRect inWeb = NSMakeRect(x, localY, w, h);
			NSRect inHost = [bethWeb convertRect:inWeb toView:bethGlassHost];
			BethGlassPlate *g = [[BethGlassPlate alloc] initWithFrame:inHost];
			g.cornerRadius = rad > 0 ? rad : 8;
			g.clipsToBounds = YES;
			BOOL field = [r[@"f"] intValue] == 1;
			BOOL tip = [r[@"tip"] intValue] == 1;
			NSString *text = r[@"t"];

			g.bethSelected = [r[@"on"] intValue] == 1;
			g.bethHover = [r[@"hov"] intValue] == 1;
			g.bethTip = tip;
			if (isRow) {
				// Mesmo material dos botões Ver, mas atrás do WebView: o HTML
				// (nome, na aba, badge) fica por cima do vidro. Sem rótulo nativo.
				(void)text;
				NSView *host = bethRowHost != nil ? bethRowHost : bethGlassHost;
				// Garante rowHost acima do vibrancy e abaixo do web.
				if (host == bethRowHost && bethWeb != nil && bethRowHost.superview != nil) {
					NSView *parent = bethRowHost.superview;
					[bethRowHost removeFromSuperview];
					[parent addSubview:bethRowHost positioned:NSWindowBelow relativeTo:bethWeb];
				}
				g.frame = [bethWeb convertRect:inWeb toView:host];
				g.bethTip = NO;
				[g bethApplyTint];
				[host addSubview:g];
				n++;
				continue;
			}
			// Potência escolhe a força do material; transparência multiplica o véu.
			// Os dois vão de quase invisível a bem fechado, inclusive no
			// selecionado e no hover.
			[g bethApplyTint];
			if (tip) {
				NSString *side = r[@"side"];
				CGFloat ax = [r[@"ax"] doubleValue];
				CGFloat aw = 8;
				NSRect body = NSMakeRect(0, 0, w, h);
				if ([side isEqualToString:@"below"]) body = NSMakeRect(0, 0, w, h - aw);
				else if ([side isEqualToString:@"above"]) body = NSMakeRect(0, aw, w, h - aw);
				else if ([side isEqualToString:@"right"]) body = NSMakeRect(aw, 0, w - aw, h);
				else if ([side isEqualToString:@"left"]) body = NSMakeRect(0, 0, w - aw, h);
				g.frame = inHost;
				BethGlassPlate *arrow = [[BethGlassPlate alloc] initWithFrame:NSZeroRect];
				arrow.bethSelected = g.bethSelected;
				arrow.bethHover = g.bethHover;
				arrow.bethTip = YES;
				arrow.cornerRadius = 2;
				[arrow bethApplyTint];
				if ([side isEqualToString:@"below"]) arrow.frame = NSMakeRect(inHost.origin.x + ax - aw / 2, NSMaxY(inHost) - aw, aw, aw);
				else if ([side isEqualToString:@"above"]) arrow.frame = NSMakeRect(inHost.origin.x + ax - aw / 2, inHost.origin.y, aw, aw);
				else if ([side isEqualToString:@"right"]) arrow.frame = NSMakeRect(inHost.origin.x, inHost.origin.y + h / 2 - aw / 2, aw, aw);
				else arrow.frame = NSMakeRect(NSMaxX(inHost) - aw, inHost.origin.y + h / 2 - aw / 2, aw, aw);
				g.frame = NSMakeRect(inHost.origin.x + body.origin.x, inHost.origin.y + body.origin.y, body.size.width, body.size.height);
				[bethGlassHost addSubview:arrow];
				NSView *box = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, g.frame.size.width, g.frame.size.height)];
				CGFloat bw = box.frame.size.width;
				CGFloat bh = box.frame.size.height;
				NSString *title = [text isKindOfClass:[NSString class]] ? text : @"";
				NSString *desc = r[@"sub"];
				NSTextField *label = [NSTextField labelWithString:title];
				label.font = [NSFont systemFontOfSize:12 weight:NSFontWeightSemibold];
				label.textColor = bethGlassInk(NO);
				label.lineBreakMode = NSLineBreakByTruncatingTail;
				[label sizeToFit];
				label.frame = NSMakeRect(10, bh - label.frame.size.height - 7, bw - 20, label.frame.size.height);
				[box addSubview:label];
				if ([desc isKindOfClass:[NSString class]] && desc.length > 0) {
					NSTextField *line2 = [NSTextField labelWithString:desc];
					line2.font = [NSFont systemFontOfSize:11 weight:NSFontWeightRegular];
					line2.textColor = bethGlassDark ? [NSColor colorWithWhite:1 alpha:0.7] : [NSColor colorWithWhite:0.35 alpha:1];
					line2.lineBreakMode = NSLineBreakByWordWrapping;
					line2.maximumNumberOfLines = 3;
					line2.frame = NSMakeRect(10, 6, w - 20, h - label.frame.size.height - 14);
					[box addSubview:line2];
				}
				g.contentView = box;
				[bethGlassHost addSubview:g];
				n++;
				continue;
			}
			if (field) {
				NSView *box = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, w, h)];
				NSImage *mag = [NSImage imageWithSystemSymbolName:@"magnifyingglass" accessibilityDescription:nil];
				if (mag != nil) {
					NSImageView *icon = [NSImageView imageViewWithImage:mag];
					icon.contentTintColor = bethGlassDark ? [NSColor colorWithWhite:1 alpha:0.85] : [NSColor colorWithWhite:0.35 alpha:1];
					icon.frame = NSMakeRect(12, (h - 14) / 2.0, 14, 14);
					[box addSubview:icon];
				}
				NSString *shown = [text isKindOfClass:[NSString class]] && text.length > 0 ? text : @"Buscar terminal ou pasta";
				NSTextField *label = [NSTextField labelWithString:shown];
				label.font = [NSFont systemFontOfSize:13 weight:NSFontWeightRegular];
				BOOL ph = [r[@"ph"] intValue] == 1;
				label.textColor = bethGlassDark
					? (ph ? [NSColor colorWithWhite:1 alpha:0.62] : [NSColor whiteColor])
					: (ph ? [NSColor colorWithWhite:0.45 alpha:1] : [NSColor colorWithWhite:0.15 alpha:1]);
				label.alignment = NSTextAlignmentLeft;
				label.lineBreakMode = NSLineBreakByTruncatingTail;
				[label sizeToFit];
				NSSize ls = label.frame.size;
				label.frame = NSMakeRect(32, (h - ls.height) / 2.0, w - 44, ls.height);
				[box addSubview:label];
				g.contentView = box;
				[bethGlassHost addSubview:g];
				n++;
				continue;
			}
			NSString *png = r[@"p"];
			if ([png isKindOfClass:[NSString class]] && png.length > 20) {
				NSData *data = [[NSData alloc] initWithBase64EncodedString:png options:NSDataBase64DecodingIgnoreUnknownCharacters];
				NSImage *img = [[NSImage alloc] initWithData:data];
				if (img != nil) {
					NSView *box = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, w, h)];
					BOOL labeled = [text isKindOfClass:[NSString class]] && text.length > 0 && w > 80;
					CGFloat icon = labeled ? 14 : 16;
					CGFloat ix = labeled ? 10 : (w - icon) / 2.0;
					NSImageView *view = [[NSImageView alloc] initWithFrame:NSMakeRect(ix, (h - icon) / 2.0, icon, icon)];
					// Silhueta (mono): o AppKit pinta com a tinta do tema —
					// escura no claro (guia inativa), branca no selecionado.
					BOOL mono = [r[@"mono"] intValue] == 1;
					img.template = mono;
					view.image = img;
					view.imageScaling = NSImageScaleProportionallyUpOrDown;
					if (mono) view.contentTintColor = bethGlassInk([r[@"on"] intValue] == 1);
					[box addSubview:view];
					if (labeled && [r[@"wrap"] intValue] == 1) {
						// Ícone em cima. O texto quebra só nos espaços, no
						// centro, e não passa da borda do botão.
						// Sempre claro: labelColor do sistema fica preto no
						// tema claro e some no Vibrancy.
						box.clipsToBounds = YES;
						NSFont *font = [NSFont systemFontOfSize:11 weight:NSFontWeightMedium];
						NSColor *ink = bethGlassInk([r[@"on"] intValue] == 1);
						// A página mede em CSS px; o AppKit desenha em pontos
						// da tela. Sem este fator o texto sai mais largo que
						// o botão e a quebra nunca dispara.
						CGFloat scale = bethWindow.screen.backingScaleFactor;
						if (scale < 1) scale = 2;
						CGFloat textW = MAX(20, floor((w - 12) / scale));
						NSArray *words = [text componentsSeparatedByString:@" "];
						NSMutableArray *lines = [NSMutableArray array];
						NSMutableString *cur = [NSMutableString string];
						for (NSString *word in words) {
							if (word.length == 0) continue;
							NSString *trial = cur.length == 0 ? word : [cur stringByAppendingFormat:@" %@", word];
							CGFloat tw = ceil([trial sizeWithAttributes:@{NSFontAttributeName: font}].width);
							if (cur.length > 0 && tw > textW) {
								[lines addObject:[cur copy]];
								[cur setString:word];
							} else {
								[cur setString:trial];
							}
						}
						if (cur.length > 0) [lines addObject:[cur copy]];
						if (lines.count > 3) lines = [[lines subarrayWithRange:NSMakeRange(0, 3)] mutableCopy];
						CGFloat lineH = 13;
						CGFloat gap = 2;
						CGFloat stack = icon + gap + lineH * lines.count;
						CGFloat top = MIN(h - 2, (h + stack) / 2.0);
						view.frame = NSMakeRect((w - icon) / 2.0, top - icon, icon, icon);
						CGFloat y = top - icon - gap - lineH;
						CGFloat labelW = MAX(20, w - 8);
						for (NSString *line in lines) {
							NSTextField *label = [NSTextField labelWithString:line];
							label.font = font;
							label.textColor = ink;
							label.alignment = NSTextAlignmentCenter;
							label.lineBreakMode = NSLineBreakByClipping;
							label.maximumNumberOfLines = 1;
							label.frame = NSMakeRect(4, y, labelW, lineH);
							label.clipsToBounds = YES;
							[box addSubview:label];
							y -= lineH;
						}
					} else if (labeled) {
						NSString *sub = r[@"sub"];
						BOOL two = [sub isKindOfClass:[NSString class]] && sub.length > 0;
						NSTextField *label = [NSTextField labelWithString:text];
						label.font = [NSFont systemFontOfSize:13 weight:NSFontWeightMedium];
						label.textColor = bethGlassInk(NO);
						label.lineBreakMode = NSLineBreakByTruncatingTail;
						CGFloat textW = w - ix - icon - 12;
						if (two) {
							label.frame = NSMakeRect(ix + icon + 4, h / 2.0 - 1, textW, h / 2.0 - 2);
							NSTextField *line2 = [NSTextField labelWithString:sub];
							line2.font = [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular];
							line2.textColor = bethGlassDark ? [NSColor colorWithWhite:0.7 alpha:1] : [NSColor colorWithWhite:0.35 alpha:1];
							line2.lineBreakMode = NSLineBreakByTruncatingTail;
							line2.frame = NSMakeRect(ix + icon + 4, 3, textW, h / 2.0 - 4);
							[box addSubview:line2];
						} else {
							[label sizeToFit];
							label.frame = NSMakeRect(ix + icon + 4, (h - label.frame.size.height) / 2.0, textW, label.frame.size.height);
						}
						[box addSubview:label];
					}
					g.contentView = box;
				}
			} else if ([text isKindOfClass:[NSString class]] && text.length > 0 && text.length < 40) {
				NSView *box = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, w, h)];
				NSTextField *label = [NSTextField labelWithString:text];
				label.font = [NSFont systemFontOfSize:11 weight:NSFontWeightMedium];
				label.textColor = bethGlassInk([r[@"on"] intValue] == 1);
				label.alignment = NSTextAlignmentCenter;
				label.lineBreakMode = NSLineBreakByTruncatingTail;
				[label sizeToFit];
				NSSize ls = label.frame.size;
				label.frame = NSMakeRect(2, (h - ls.height) / 2.0, w - 4, ls.height);
				[box addSubview:label];
				g.contentView = box;
			}
			[bethGlassHost addSubview:g];
			n++;
		}
		NSLog(@"beth glass plates %ld", (long)n);
	}
}

@interface BethMenuButton : NSButton
@end

@implementation BethMenuButton {
	NSTrackingArea *_hoverArea;
}
- (void)updateTrackingAreas {
	[super updateTrackingAreas];
	if (_hoverArea != nil) [self removeTrackingArea:_hoverArea];
	_hoverArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect
		options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect
		owner:self userInfo:nil];
	[self addTrackingArea:_hoverArea];
}
- (void)mouseEntered:(NSEvent *)event {
	(void)event;
	if (self.enabled) self.layer.backgroundColor = [NSColor colorWithWhite:1 alpha:0.13].CGColor;
}
- (void)mouseExited:(NSEvent *)event {
	(void)event;
	self.layer.backgroundColor = nil;
}
@end

static NSPopover *bethMenuPop = nil;
static NSPopover *bethTipPop = nil;

@interface BethMenuBridge : NSObject <NSPopoverDelegate>
@end

@implementation BethMenuBridge
- (void)fire:(NSButton *)sender {
	NSString *js = [NSString stringWithFormat:@"window.__bethMenuClick && window.__bethMenuClick(%ld)", (long)sender.tag];
	NSPopover *clicked = bethMenuPop;
	[bethWeb evaluateJavaScript:js completionHandler:^(id result, NSError *error) {
		(void)result;
		(void)error;
		if (bethMenuPop == clicked) [clicked close];
	}];
}
- (void)popoverDidClose:(NSNotification *)note {
	if (note.object == bethTipPop) {
		bethTipPop = nil;
		return;
	}
	if (note.object != bethMenuPop) return;
	bethMenuPop = nil;
	[bethWeb evaluateJavaScript:@"window.__bethMenuClosed && window.__bethMenuClosed()" completionHandler:nil];
}
@end

static BethMenuBridge *bethMenuBridge = nil;

static void bethCloseTipPop(void) {
	if (bethTipPop == nil) return;
	NSPopover *previous = bethTipPop;
	bethTipPop = nil;
	[previous close];
}

static void bethApplyMenu(NSString *body) {
	if (bethWeb == nil) return;
	bethCloseTipPop();
	if (bethMenuPop != nil) {
		NSPopover *previous = bethMenuPop;
		bethMenuPop = nil;
		[previous close];
	}
	if (body.length < 3 || [body isEqualToString:@"[]"]) return;
	if (@available(macOS 14.0, *)) {
		NSData *data = [body dataUsingEncoding:NSUTF8StringEncoding];
		NSDictionary *r = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
		if (![r isKindOfClass:[NSDictionary class]]) return;
		CGFloat x = [r[@"x"] doubleValue];
		CGFloat y = [r[@"y"] doubleValue];
		CGFloat w = [r[@"w"] doubleValue];
		CGFloat h = [r[@"h"] doubleValue];
		if (w < 40 || h < 20) return;
		CGFloat pageH = bethWeb.bounds.size.height;
		NSArray *rows = r[@"rows"];
		NSView *box = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, w, h)];
		if (bethMenuBridge == nil) bethMenuBridge = [BethMenuBridge new];
		NSInteger drawn = 0;
		if ([rows isKindOfClass:[NSArray class]]) {
			for (id row in rows) {
				if (![row isKindOfClass:[NSDictionary class]]) continue;
				NSInteger at = drawn;
				drawn++;
				NSDictionary *item = row;
				CGFloat rowH = [item[@"h"] doubleValue];
				CGFloat top = [item[@"y"] doubleValue];
				if (rowH < 1) rowH = 28;
				CGFloat y0 = h - top - rowH;
				NSString *line = item[@"t"];
				if (![line isKindOfClass:[NSString class]]) line = @"";
				if (line.length == 0) {
					NSBox *rule = [[NSBox alloc] initWithFrame:NSMakeRect(12, y0 + rowH / 2.0, w - 24, 1)];
					rule.boxType = NSBoxSeparator;
					[box addSubview:rule];
					continue;
				}
				BethMenuButton *b = [[BethMenuButton alloc] initWithFrame:NSMakeRect(6, y0, w - 12, rowH)];
				b.title = line;
				b.target = bethMenuBridge;
				b.action = @selector(fire:);
				b.wantsLayer = YES;
				b.layer.cornerRadius = 7;
				// O índice do clique é a posição na lista desenhada, a mesma
				// ordem de button + .bt-menu-rule. A divisória ocupa uma
				// posição e não vira botão; o item seguinte não herda o clique.
				b.tag = at;
				b.bordered = NO;
				b.enabled = ![item[@"disabled"] boolValue];
				b.alignment = NSTextAlignmentLeft;
				b.font = [NSFont systemFontOfSize:13];
				NSString *sym = item[@"i"];
				if ([sym isKindOfClass:[NSString class]] && sym.length > 0) {
					NSImage *img = [NSImage imageWithSystemSymbolName:sym accessibilityDescription:nil];
					if (img != nil) {
						img.size = NSMakeSize(15, 15);
						b.image = img;
						b.imagePosition = NSImageLeft;
					}
				}
				if ([item[@"d"] intValue] == 1) b.contentTintColor = [NSColor systemRedColor];
				[box addSubview:b];
			}
		}
		NSViewController *vc = [[NSViewController alloc] init];
		vc.view = box;
		NSPopover *pop = [[NSPopover alloc] init];
		pop.contentViewController = vc;
		pop.contentSize = NSMakeSize(w, h);
		// A página já trata o próximo clique fora e Esc. O AppKit não deve
		// fechar o popover ao terminar o gesto que acabou de abri-lo.
		pop.behavior = NSPopoverBehaviorApplicationDefined;
		pop.animates = YES;
		pop.delegate = bethMenuBridge;
		CGFloat ax = [r[@"ax"] doubleValue];
		CGFloat anchorY = bethWeb.isFlipped ? y : (pageH - y);
		NSRect anchor = NSMakeRect(x + ax, anchorY, 2, 2);
		bethMenuPop = pop;
		[pop showRelativeToRect:anchor ofView:bethWeb preferredEdge:NSRectEdgeMinY];
		box.window.acceptsMouseMovedEvents = YES;
	}
}

void bethSetMenu(const char *json) {
	NSString *body = json ? [NSString stringWithUTF8String:json] : @"";
	if (![NSThread isMainThread]) {
		dispatch_async(dispatch_get_main_queue(), ^{ bethApplyMenu(body); });
		return;
	}
	bethApplyMenu(body);
}

// Tooltip: o mesmo NSPopover do menu de contexto (liquid glass nativo),
// sem seta desenhada à mão. ignoresMouseEvents evita sumir ao passar o mouse.
static void bethApplyTip(NSString *body) {
	if (bethWeb == nil) return;
	bethCloseTipPop();
	if (bethTipHost != nil) {
		for (NSView *child in [bethTipHost.subviews copy]) [child removeFromSuperview];
	}
	if (body.length < 3 || [body isEqualToString:@"[]"]) return;
	if (@available(macOS 14.0, *)) {
		NSData *data = [body dataUsingEncoding:NSUTF8StringEncoding];
		NSDictionary *r = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
		if (![r isKindOfClass:[NSDictionary class]]) return;
		NSString *title = [r[@"title"] isKindOfClass:[NSString class]] ? r[@"title"] : @"";
		NSString *desc = [r[@"desc"] isKindOfClass:[NSString class]] ? r[@"desc"] : @"";
		if (title.length == 0) return;
		CGFloat ax = [r[@"ax"] doubleValue];
		CGFloat ay = [r[@"ay"] doubleValue];
		CGFloat aw = [r[@"aw"] doubleValue];
		CGFloat ah = [r[@"ah"] doubleValue];
		if (aw < 1) aw = 2;
		if (ah < 1) ah = 2;
		BOOL preferAbove = [r[@"above"] intValue] == 1;
		CGFloat textW = 220;
		NSFont *titleFont = [NSFont systemFontOfSize:13 weight:NSFontWeightMedium];
		NSFont *descFont = [NSFont systemFontOfSize:12 weight:NSFontWeightRegular];
		NSRect titleBox = [title boundingRectWithSize:NSMakeSize(textW, 60) options:NSStringDrawingUsesLineFragmentOrigin attributes:@{ NSFontAttributeName: titleFont }];
		NSRect descBox = desc.length ? [desc boundingRectWithSize:NSMakeSize(textW, 80) options:NSStringDrawingUsesLineFragmentOrigin attributes:@{ NSFontAttributeName: descFont }] : NSZeroRect;
		CGFloat labelH = ceil(titleBox.size.height);
		CGFloat descH = desc.length ? ceil(descBox.size.height) : 0;
		CGFloat padX = 12;
		CGFloat padY = 8;
		CGFloat gap = descH > 0 ? 2 : 0;
		CGFloat contentW = MIN(textW, MAX(ceil(titleBox.size.width), ceil(descBox.size.width))) + padX * 2;
		if (contentW < 80) contentW = 80;
		CGFloat contentH = padY + labelH + gap + descH + padY;
		NSView *box = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, contentW, contentH)];
		NSTextField *label = [NSTextField wrappingLabelWithString:title];
		label.font = titleFont;
		label.textColor = [NSColor labelColor];
		label.maximumNumberOfLines = 3;
		label.frame = NSMakeRect(padX, contentH - padY - labelH, contentW - padX * 2, labelH);
		[box addSubview:label];
		if (descH > 0) {
			NSTextField *line2 = [NSTextField wrappingLabelWithString:desc];
			line2.font = descFont;
			line2.textColor = [NSColor secondaryLabelColor];
			line2.maximumNumberOfLines = 4;
			line2.frame = NSMakeRect(padX, padY, contentW - padX * 2, descH);
			[box addSubview:line2];
		}
		if (bethMenuBridge == nil) bethMenuBridge = [BethMenuBridge new];
		NSViewController *vc = [[NSViewController alloc] init];
		vc.view = box;
		NSPopover *pop = [[NSPopover alloc] init];
		pop.contentViewController = vc;
		pop.contentSize = NSMakeSize(contentW, contentH);
		pop.behavior = NSPopoverBehaviorApplicationDefined;
		pop.animates = YES;
		pop.delegate = bethMenuBridge;
		CGFloat pageH = bethWeb.bounds.size.height;
		CGFloat anchorY = bethWeb.isFlipped ? ay : (pageH - ay - ah);
		NSRect anchor = NSMakeRect(ax, anchorY, aw, ah);
		bethTipPop = pop;
		NSRectEdge edge = preferAbove ? NSRectEdgeMaxY : NSRectEdgeMinY;
		[pop showRelativeToRect:anchor ofView:bethWeb preferredEdge:edge];
		NSWindow *win = box.window;
		win.ignoresMouseEvents = YES;
	}
}

void bethSetTip(const char *json) {
	NSString *body = json ? [NSString stringWithUTF8String:json] : @"";
	if (![NSThread isMainThread]) {
		dispatch_async(dispatch_get_main_queue(), ^{ bethApplyTip(body); });
		return;
	}
	bethApplyTip(body);
}

void bethSetGlass(const char *json) {
	NSString *body = json ? [NSString stringWithUTF8String:json] : @"";
	if (![NSThread isMainThread]) {
		dispatch_async(dispatch_get_main_queue(), ^{ bethApplyGlass(body); });
		return;
	}
	bethApplyGlass(body);
}

static void bethPlaceTitleDrag(void) {
	if (bethWindow == nil || bethTitleDrag == nil) return;
	NSView *content = bethWindow.contentView;
	CGFloat h = content.bounds.size.height;
	CGFloat w = bethSidebarWidth;
	if (w < 78) w = 78;
	// Semáforos ocupam ~70 pt. O resto da faixa de 40 pt move a janela.
	bethTitleDrag.frame = NSMakeRect(70, h - 40, MAX(8, w - 70), 40);
}

void bethSetSidebarWidth(double width) {
	if (![NSThread isMainThread]) {
		double w = width;
		dispatch_async(dispatch_get_main_queue(), ^{ bethSetSidebarWidth(w); });
		return;
	}
	// Com vibrancy o material cobre a janela inteira. A página deixa
	// transparente tudo que está fora da caixa do terminal.
	bethSidebarWidth = width < 0 ? 0 : width;
	bethPlaceTitleDrag();
	bethApplySidebarHole();
}

static char bethGutter[96] = "unset";

// A página manda a cor da topbar (rgb/rgba). Sem isso o vão fica o preto
// da janela transparente — no tema claro isso aparece nos cantos do cartão.
static NSColor *bethGutterColor(void) {
	const char *s = bethGutter;
	int r = 0, g = 0, b = 0;
	float a = 1;
	// A página pinta 26 e o print devolve 32. O vão nativo, atrás do
	// WebView, precisa do sRGB que a captura lê como 26.
	if (sscanf(s, "rgb(%d, %d, %d)", &r, &g, &b) == 3 || sscanf(s, "rgb(%d,%d,%d)", &r, &g, &b) == 3 ||
	    sscanf(s, "rgb(%d %d %d)", &r, &g, &b) == 3) {
		if (r == 26 && g == 26 && b == 26) {
			return [NSColor colorWithSRGBRed:19.0 / 255.0 green:19.0 / 255.0 blue:19.0 / 255.0 alpha:1];
		}
		return [NSColor colorWithSRGBRed:r / 255.0 green:g / 255.0 blue:b / 255.0 alpha:1];
	}
	if (sscanf(s, "rgba(%d, %d, %d, %f)", &r, &g, &b, &a) == 4 || sscanf(s, "rgba(%d,%d,%d,%f)", &r, &g, &b, &a) == 4 ||
	    sscanf(s, "rgba(%d %d %d / %f)", &r, &g, &b, &a) == 4) {
		return [NSColor colorWithSRGBRed:r / 255.0 green:g / 255.0 blue:b / 255.0 alpha:a];
	}
	// Antes da 1ª mensagem da página: segue o tema (claro ≠ preto).
	if (!bethGlassDark) {
		return [NSColor colorWithSRGBRed:236.0 / 255.0 green:236.0 / 255.0 blue:236.0 / 255.0 alpha:1];
	}
	return [NSColor colorWithSRGBRed:19.0 / 255.0 green:19.0 / 255.0 blue:19.0 / 255.0 alpha:1];
}

void bethWriteFrame(int on) {
	(void)on;
	if (bethWindow == nil || bethVibrancy == nil) return;
	NSRect vf = bethVibrancy.frame;
	CGFloat h = bethWindow.contentView.bounds.size.height;
	FILE *logf = fopen("/tmp/beth-vibrancy-frame.txt", "a");
	if (logf == NULL) return;
	fprintf(logf, "glass x %.0f y %.0f w %.0f h %.0f windowH %.0f gutter %s\n", vf.origin.x, vf.origin.y, vf.size.width, vf.size.height, h, bethGutter);
	fclose(logf);
}

void bethSetVibrancy(int on) {
	if (bethWindow == nil) return;
	{
		CGFloat h = bethWindow.contentView.bounds.size.height;
		double frameTop = 0, frameBottom = 0;
		bethSidebarFrame(h, &frameTop, &frameBottom);
	}
	NSView *content = bethWindow.contentView;
	if (!on) {
		[bethVibrancy removeFromSuperview];
		bethVibrancy = nil;
		if (bethGutterStrip != nil) {
			[bethGutterStrip removeFromSuperview];
			bethGutterStrip = nil;
		}
		if (bethWindow != nil) {
			bethWindow.backgroundColor = bethGutterColor();
		}
		if (bethWeb != nil) {
			bethWeb.underPageBackgroundColor = bethGutterColor();
			[bethWeb setValue:@YES forKey:@"drawsBackground"];
		}
		return;
	}
	if (bethWeb != nil) {
		bethWeb.underPageBackgroundColor = [NSColor clearColor];
		// Sem isto o WebView compõe um fundo opaco e o material nunca aparece,
		// mesmo com a página transparente.
		[bethWeb setValue:@NO forKey:@"drawsBackground"];
	}
	if (bethVibrancy == nil) {
		NSVisualEffectView *fx = [[NSVisualEffectView alloc] initWithFrame:NSMakeRect(0, 0, 0, content.bounds.size.height)];
		// Claro: Sidebar fica quase opaco (igual à topbar). UnderWindow
		// deixa o blur do wallpaper aparecer. Escuro: Sidebar continua ok.
		fx.material = bethGlassDark ? NSVisualEffectMaterialSidebar : NSVisualEffectMaterialUnderWindowBackground;
		// BehindWindow amostra o wallpaper. O cartão da página fica
		// transparente, então o material aparece atrás da lista. Na frente
		// do WebView o vidro cobriria busca, botões e texto.
		fx.blendingMode = NSVisualEffectBlendingModeBehindWindow;
		fx.state = NSVisualEffectStateActive;
		[content addSubview:fx positioned:NSWindowBelow relativeTo:bethWeb];
		bethVibrancy = fx;
	} else {
		bethVibrancy.material = bethGlassDark ? NSVisualEffectMaterialSidebar : NSVisualEffectMaterialUnderWindowBackground;
	}
	// Camadas atrás do WebView: vibrancy (fundo) → rowHost (placa do chat)
	// → web (texto por cima do vidro). Sem isto o rowHost ficava sob o
	// vibrancy e a placa do selecionado sumia.
	if (bethVibrancy != nil) {
		[bethVibrancy removeFromSuperview];
		[content addSubview:bethVibrancy positioned:NSWindowBelow relativeTo:bethWeb];
	}
	if (bethRowHost != nil) {
		[bethRowHost removeFromSuperview];
		[content addSubview:bethRowHost positioned:NSWindowBelow relativeTo:bethWeb];
	}
	bethApplySidebarHole();
}

void bethZoomWindow(void) {
	if (bethWindow == nil) return;
	[bethWindow performZoom:nil];
}

void bethDragWindow(void) {
	NSEvent *ev = [NSApp currentEvent];
	if (bethWindow == nil || ev == nil) return;
	[bethWindow performWindowDragWithEvent:ev];
}

static BethWindowDelegate *bethWindowDelegate = nil;

@interface BethDragView : NSView
@end

@implementation BethDragView
- (BOOL)mouseDownCanMoveWindow { return YES; }
- (void)mouseDown:(NSEvent *)event { [self.window performWindowDragWithEvent:event]; }
- (void)rightMouseDown:(NSEvent *)event {
	NSMenu *menu = [[NSMenu alloc] init];
	NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:@"Inspecionar (console)" action:@selector(bethInspectFromMenu:) keyEquivalent:@""];
	[item setTarget:self];
	[menu addItem:item];
	[NSMenu popUpContextMenu:menu withEvent:event forView:self];
}
- (void)bethInspectFromMenu:(id)sender { (void)sender; bethInspect(); }
@end

// WKWebView comum. O arraste da janela sai da faixa vazia, pelo JavaScript;
// um hitTest aqui engolia o clique das abas e dos botões.
@interface BethWebView : WKWebView
@end

@implementation BethWebView
- (BOOL)performKeyEquivalent:(NSEvent *)event {
	NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
	BOOL cmd = (mods & NSEventModifierFlagCommand) != 0;
	BOOL extra = (mods & (NSEventModifierFlagShift | NSEventModifierFlagOption | NSEventModifierFlagControl)) != 0;
	if (cmd && !extra) {
		NSString *ch = event.charactersIgnoringModifiers.lowercaseString;
		if ([ch isEqualToString:@"t"]) {
			[self evaluateJavaScript:@"window.dispatchEvent(new CustomEvent('beth-shortcut',{detail:'new_tab'}))" completionHandler:nil];
			return YES;
		}
	}
	return [super performKeyEquivalent:event];
}
@end

@interface BethWebDelegate : NSObject <WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler>
@property (nonatomic, copy) NSString *origin;
@end

@implementation BethWebDelegate

- (NSString *)originOf:(NSURL *)url {
	if (url.scheme.length == 0 || url.host.length == 0) return @"";
	if (url.port != nil) {
		return [NSString stringWithFormat:@"%@://%@:%@", url.scheme, url.host, url.port];
	}
	return [NSString stringWithFormat:@"%@://%@", url.scheme, url.host];
}

- (BOOL)isOurs:(NSURL *)url {
	NSString *s = url.absoluteString ?: @"";
	if ([s hasPrefix:@"about:"] || [s hasPrefix:@"data:"]) return YES;
	NSString *origin = [self originOf:url];
	if (origin.length == 0) return NO;
	if (self.origin == nil) {
		self.origin = origin;
		return YES;
	}
	return [origin isEqualToString:self.origin];
}

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
	(void)webView;
	NSURL *url = action.request.URL;
	if (url != nil && ![self isOurs:url]) {
		decisionHandler(WKNavigationActionPolicyCancel);
		[[NSWorkspace sharedWorkspace] openURL:url];
		return;
	}
	decisionHandler(WKNavigationActionPolicyAllow);
}

- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)windowFeatures {
	(void)webView; (void)configuration; (void)windowFeatures;
	NSURL *url = action.request.URL;
	if (url != nil) {
		[[NSWorkspace sharedWorkspace] openURL:url];
	}
	return nil;
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
	(void)webView;
	dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
		[webView evaluateJavaScript:@"window.__bethLog || window.__bethMark || 'no mark'" completionHandler:^(id v, NSError *err) {
			NSLog(@"beth boot %@ %@", v, err);
		}];
		[webView evaluateJavaScript:@"(function(){var s=document.querySelector('.bt-sidebar');var t=document.querySelector('.bt-tabstrip');var g=function(el){return el?getComputedStyle(el).backgroundColor:'missing'};var r=t?t.getBoundingClientRect():null;return JSON.stringify({cls:document.documentElement.className,html:g(document.documentElement),body:g(document.body),root:g(document.getElementById('root')),side:g(s),tabTop:r?r.top:null,innerHeight:window.innerHeight});})()" completionHandler:^(id v, NSError *err) {
			NSLog(@"beth paint %@ %@", v, err);
		}];
	});
	(void)navigation;
	NSLog(@"beth webview finished %@", webView.URL);
	[webView evaluateJavaScript:@"document.body ? document.body.innerText.slice(0, 180) : 'no body'" completionHandler:^(id v, NSError *err) {
		NSLog(@"beth webview body %@ err %@", v, err);
	}];
	[webView evaluateJavaScript:@"JSON.stringify({mark: window.__bethMark || '', err: window.__bethErr || '', sheets: document.styleSheets.length, root: document.getElementById('root') ? document.getElementById('root').childElementCount : -1})" completionHandler:^(id v, NSError *err) {
		NSLog(@"beth webview state %@ %@", v, err);
	}];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
	(void)navigation;
	NSLog(@"beth webview fail %@", error);
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
	(void)navigation;
	NSLog(@"beth webview provisional fail %@", error);
}

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
	(void)controller;
	if ([message.name isEqualToString:@"bethDrag"]) {
		NSString *body = [message.body description];
		if ([body isEqualToString:@"zoom"]) bethZoomWindow();
		else if ([body isEqualToString:@"close"]) {
			bethAllowClose = 1;
			[NSApp terminate:nil];
		} else bethDragWindow();
	} else if ([message.name isEqualToString:@"bethVibrancy"]) {
		bethSetVibrancy([[message.body description] isEqualToString:@"1"] ? 1 : 0);
	} else if ([message.name isEqualToString:@"bethSidebar"]) {
		bethSetSidebarWidth([[message.body description] doubleValue]);
	} else if ([message.name isEqualToString:@"bethGutter"]) {
		NSString *g = [message.body description];
		if (g.length > 0 && g.length < 90) snprintf(bethGutter, sizeof(bethGutter), "%s", g.UTF8String);
		// A cor chega depois do vibrancy (mesmo effect da página). Sem
		// reaplica, a faixa fica no default escuro e o tema claro mostra
		// preto nos cantos do cartão.
		if (bethVibrancy != nil) bethApplySidebarHole();
	} else if ([message.name isEqualToString:@"bethGlassTune"]) {
		// "power,alpha" ou "power,alpha,r,g,b" (r/g/b = 0–255 do --bt-accent).
		NSArray *parts = [[message.body description] componentsSeparatedByString:@","];
		if (parts.count > 0) {
			CGFloat v = [parts[0] doubleValue];
			if (v < 0.15) v = 0.15;
			if (v > 1) v = 1;
			bethGlassPower = v;
		}
		if (parts.count > 1) {
			CGFloat v = [parts[1] doubleValue];
			if (v < 0.15) v = 0.15;
			if (v > 1) v = 1;
			bethGlassAlpha = v;
		}
		if (parts.count >= 5) {
			CGFloat rr = [parts[2] doubleValue] / 255.0;
			CGFloat gg = [parts[3] doubleValue] / 255.0;
			CGFloat bb = [parts[4] doubleValue] / 255.0;
			if (rr < 0) rr = 0; if (rr > 1) rr = 1;
			if (gg < 0) gg = 0; if (gg > 1) gg = 1;
			if (bb < 0) bb = 0; if (bb > 1) bb = 1;
			bethAccentR = rr;
			bethAccentG = gg;
			bethAccentB = bb;
		}
		if (parts.count >= 6) {
			bethGlassDark = [parts[5] intValue] != 0;
			NSAppearance *ap = [NSAppearance appearanceNamed:bethGlassDark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
			if (bethWindow != nil) bethWindow.appearance = ap;
			if (bethVibrancy != nil) {
				bethVibrancy.appearance = ap;
				bethVibrancy.material = bethGlassDark ? NSVisualEffectMaterialSidebar : NSVisualEffectMaterialUnderWindowBackground;
			}
			if (bethGlassHost != nil) bethGlassHost.appearance = ap;
			if (bethRowHost != nil) bethRowHost.appearance = ap;
			// Troca claro/escuro às vezes religa o fundo opaco do WKWebView.
			if (bethVibrancy != nil && bethWeb != nil) {
				bethWeb.underPageBackgroundColor = [NSColor clearColor];
				[bethWeb setValue:@NO forKey:@"drawsBackground"];
			}
			// Atualiza o vão (default claro/escuro) antes da mensagem bethGutter.
			if (bethVibrancy != nil) bethApplySidebarHole();
		}
		bethRetintGlass();
	} else if ([message.name isEqualToString:@"bethGlass"]) {
		bethSetGlass([[message.body description] UTF8String]);
	} else if ([message.name isEqualToString:@"bethTip"]) {
		bethSetTip([[message.body description] UTF8String]);
	} else if ([message.name isEqualToString:@"bethMenu"]) {
		bethSetMenu([[message.body description] UTF8String]);
	}
}

- (void)webView:(WKWebView *)webView requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin initiatedByFrame:(WKFrameInfo *)frame type:(WKMediaCaptureType)type decisionHandler:(void (^)(WKPermissionDecision))decisionHandler API_AVAILABLE(macos(12.0)) {
	(void)webView; (void)origin; (void)frame;
	if (type == WKMediaCaptureTypeMicrophone) {
		decisionHandler(WKPermissionDecisionGrant);
		return;
	}
	decisionHandler(WKPermissionDecisionDeny);
}

@end

static BethWebDelegate *bethWebDelegate = nil;

static NSString *bethExeDir(void) {
	NSString *exe = [[NSBundle mainBundle] executablePath];
	if (exe == nil) {
		exe = [[NSProcessInfo processInfo] arguments].firstObject;
	}
	return [exe stringByDeletingLastPathComponent];
}

// Dock / app switcher: the .icns carries 16 through 1024, the sizes
// NSApplication asks for. The art is already masked to the macOS squircle
// (corner radius 22.37% of the side).
static NSImage *bethAppIcon(void) {
	NSString *dir = bethExeDir();
	NSString *icns = [dir stringByAppendingPathComponent:@"bethstudio.icns"];
	NSImage *image = [[NSImage alloc] initWithContentsOfFile:icns];
	if (image != nil) return image;
	return [[NSImage alloc] initWithContentsOfFile:[dir stringByAppendingPathComponent:@"bethstudio-icon-1024.png"]];
}

// Menu bar status item is 18 pt (HIG). A color mark, not a template:
// the B is the brand, and a template would paint it as a black silhouette.
static NSImage *bethMenuIcon(void) {
	NSString *path = [bethExeDir() stringByAppendingPathComponent:@"bethstudio-menu.png"];
	NSImage *image = [[NSImage alloc] initWithContentsOfFile:path];
	if (image == nil) return nil;
	image.size = NSMakeSize(18, 18);
	image.template = NO;
	return image;
}

// A faixa das guias tem 40 px. Os semáforos ficam no centro vertical dela.
static void bethCenterLights(NSWindow *win) {
	if (win == nil) return;
	CGFloat mid = win.contentView.bounds.size.height - 20;
	NSWindowButton kinds[] = { NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton };
	for (int i = 0; i < 3; i++) {
		NSButton *b = [win standardWindowButton:kinds[i]];
		if (b == nil || b.superview == nil) continue;
		NSRect f = [b convertRect:b.bounds toView:nil];
		CGFloat dy = mid - NSMidY(f);
		if (fabs(dy) < 0.5) continue;
		[b setFrameOrigin:NSMakePoint(b.frame.origin.x, b.frame.origin.y + dy)];
	}
}

/* Nova aba (⌘T) e os atalhos de edição do macOS. */
@interface BethMenuTarget : NSObject
@end
@implementation BethMenuTarget
- (void)bethNewTab:(id)sender {
	(void)sender;
	if (bethWeb == nil) return;
	[bethWeb evaluateJavaScript:@"window.dispatchEvent(new CustomEvent('beth-shortcut',{detail:'new_tab'}))" completionHandler:nil];
}
@end

static BethMenuTarget *bethMenuTarget;

static void bethInstallEditMenu(void) {
	NSMenu *main = NSApp.mainMenu;
	if (main == nil) {
		main = [[NSMenu alloc] initWithTitle:@""];
		NSApp.mainMenu = main;
	}
	if (bethMenuTarget == nil) bethMenuTarget = [BethMenuTarget new];
	if ([main itemWithTitle:@"Arquivo"] == nil) {
		NSMenuItem *fileItem = [[NSMenuItem alloc] initWithTitle:@"Arquivo" action:nil keyEquivalent:@""];
		NSMenu *file = [[NSMenu alloc] initWithTitle:fileItem.title];
		NSMenuItem *nova = [[NSMenuItem alloc] initWithTitle:@"Nova aba" action:@selector(bethNewTab:) keyEquivalent:@"t"];
		nova.target = bethMenuTarget;
		[file addItem:nova];
		[main addItem:fileItem];
		fileItem.submenu = file;
	}
	if ([main itemWithTitle:@"Editar"] != nil) return;
	NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:@"Editar" action:nil keyEquivalent:@""];
	NSMenu *edit = [[NSMenu alloc] initWithTitle:item.title];
	[edit addItemWithTitle:@"Recortar" action:@selector(cut:) keyEquivalent:@"x"];
	[edit addItemWithTitle:@"Copiar" action:@selector(copy:) keyEquivalent:@"c"];
	[edit addItemWithTitle:@"Colar" action:@selector(paste:) keyEquivalent:@"v"];
	[edit addItem:[NSMenuItem separatorItem]];
	[edit addItemWithTitle:@"Selecionar tudo" action:@selector(selectAll:) keyEquivalent:@"a"];
	[main addItem:item];
	item.submenu = edit;
}

void bethEnsureApp(void) {
	[NSApplication sharedApplication];
	[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
	NSImage *logo = bethAppIcon();
	if (logo != nil) {
		[NSApp setApplicationIconImage:logo];
	}
}



void bethOpen(const char *url, const char *title, int width, int height) {
	bethEnsureApp();
	[NSApp finishLaunching];
	bethInstallEditMenu();
	[[NSNotificationCenter defaultCenter] addObserverForName:NSApplicationDidResignActiveNotification
		object:NSApp queue:nil usingBlock:^(NSNotification *note) { (void)note; [bethMenuPop close]; }];
	NSRect frame = NSMakeRect(0, 0, width, height);
	// Barra de título própria: os botões do sistema ficam, o título some e
	// a página desenha as abas nessa faixa, como um navegador. Windows não
	// passa por aqui.
	NSWindowStyleMask mask = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
	           NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
	if (!bethAuxWindow) {
		mask |= NSWindowStyleMaskFullSizeContentView;
	}
	NSWindow *win = [[NSWindow alloc]
		initWithContentRect:frame
		styleMask:mask
		backing:NSBackingStoreBuffered
		defer:NO];
	[win setTitle:[NSString stringWithUTF8String:title]];
	if (bethAuxWindow) {
		[win setTitlebarAppearsTransparent:NO];
		[win setTitleVisibility:NSWindowTitleVisible];
		win.titlebarSeparatorStyle = NSTitlebarSeparatorStyleAutomatic;
		[win setOpaque:YES];
		[win setBackgroundColor:[NSColor windowBackgroundColor]];
		// Sem FullSizeContentView os semáforos ficam na barra de título normal.
	} else {
		[win setTitlebarAppearsTransparent:YES];
		[win setTitleVisibility:NSWindowTitleHidden];
		win.titlebarSeparatorStyle = NSTitlebarSeparatorStyleNone;
		// Sem isto o material BehindWindow amostra o fundo opaco da janela.
		[win setOpaque:NO];
		[win setBackgroundColor:[NSColor clearColor]];
	}
	bethCenterLights(win);
	dispatch_async(dispatch_get_main_queue(), ^{ bethCenterLights(win); });
	[[NSNotificationCenter defaultCenter] addObserverForName:NSWindowDidResizeNotification object:win queue:nil usingBlock:^(NSNotification *n) {
		bethCenterLights(n.object);
		bethPlaceTitleDrag();
		bethApplySidebarHole();
	}];
	[win center];
	[win setReleasedWhenClosed:NO];
	if (bethWindowDelegate == nil) {
		bethWindowDelegate = [BethWindowDelegate new];
	}
	[win setDelegate:bethWindowDelegate];
	WKWebViewConfiguration *cfg = [[WKWebViewConfiguration alloc] init];
	cfg.defaultWebpagePreferences.allowsContentJavaScript = YES;

	if (bethWebDelegate == nil) {
		bethWebDelegate = [BethWebDelegate new];
	}
	BethWebView *web = [[BethWebView alloc] initWithFrame:frame configuration:cfg];
	web.navigationDelegate = bethWebDelegate;
	web.UIDelegate = bethWebDelegate;
	// Fundo opaco. Sem isso, com a página transparente (vibrancy) a janela
	// parece vazia: o material fica atrás e a página não cobre.
	web.underPageBackgroundColor = [NSColor colorWithCalibratedWhite:0.12 alpha:1];
	[cfg.userContentController addScriptMessageHandler:(id<WKScriptMessageHandler>)bethWebDelegate name:@"bethDrag"];
	[cfg.userContentController addScriptMessageHandler:(id<WKScriptMessageHandler>)bethWebDelegate name:@"bethVibrancy"];
	[cfg.userContentController addScriptMessageHandler:(id<WKScriptMessageHandler>)bethWebDelegate name:@"bethSidebar"];
	[cfg.userContentController addScriptMessageHandler:(id<WKScriptMessageHandler>)bethWebDelegate name:@"bethGutter"];
	[cfg.userContentController addScriptMessageHandler:(id<WKScriptMessageHandler>)bethWebDelegate name:@"bethGlass"];
	[cfg.userContentController addScriptMessageHandler:(id<WKScriptMessageHandler>)bethWebDelegate name:@"bethGlassTune"];
	[cfg.userContentController addScriptMessageHandler:(id<WKScriptMessageHandler>)bethWebDelegate name:@"bethTip"];
	[cfg.userContentController addScriptMessageHandler:(id<WKScriptMessageHandler>)bethWebDelegate name:@"bethMenu"];
	[web setAutoresizingMask:NSViewWidthSizable | NSViewHeightSizable];
	NSView *root = [[NSView alloc] initWithFrame:frame];
	if (bethAuxWindow) {
		// Janela auxiliar: sem vidro/liquid menus (eles cobriam o conteúdo).
		[root addSubview:web];
		[win setContentView:root];
		bethTitleDrag = nil;
		bethRowHost = nil;
		bethGlassHost = nil;
		bethTipHost = nil;
		bethMenuHost = nil;
	} else {
		// O vidro fica na frente. O conteúdo (ícone ou nome) vai dentro dele;
		// atrás da página o efeito não aparece.
		BethPassView *glassHost = [[BethPassView alloc] initWithFrame:frame];
		glassHost.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
		BethPassView *tipHost = [[BethPassView alloc] initWithFrame:frame];
		tipHost.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
		BethPassView *menuHost = [[BethPassView alloc] initWithFrame:frame];
		menuHost.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
		BethPassView *rowHost = [[BethPassView alloc] initWithFrame:frame];
		rowHost.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
		[root addSubview:rowHost];
		[root addSubview:web];
		[root addSubview:glassHost];
		[root addSubview:tipHost];
		[root addSubview:menuHost];
		[win setContentView:root];
		BethDragView *titleDrag = [[BethDragView alloc] initWithFrame:NSZeroRect];
		titleDrag.autoresizingMask = NSViewMinYMargin | NSViewWidthSizable;
		[root addSubview:titleDrag];
		bethTitleDrag = titleDrag;
		bethRowHost = rowHost;
		bethGlassHost = glassHost;
		bethTipHost = tipHost;
		bethMenuHost = menuHost;
	}

	NSURL *nsurl = [NSURL URLWithString:[NSString stringWithUTF8String:url]];
	[web loadRequest:[NSURLRequest requestWithURL:nsurl]];
	[win makeKeyAndOrderFront:nil];
	[win makeFirstResponder:web];
	[NSApp activateIgnoringOtherApps:YES];
	dispatch_async(dispatch_get_main_queue(), ^{
		[win orderFrontRegardless];
		[NSApp activateIgnoringOtherApps:YES];
	});
	bethWindow = win;
	bethWeb = web;
	bethHidden = 0;
	bethPlaceTitleDrag();
}

void bethRun(void) {
	[NSApp run];
}

void bethOrderFront(void) {
	if (bethWindow == nil) return;
	[bethWindow makeKeyAndOrderFront:nil];
	[NSApp activateIgnoringOtherApps:YES];
	bethHidden = 0;
}

void bethOrderFrontAsync(void) {
	dispatch_async(dispatch_get_main_queue(), ^{ bethOrderFront(); });
}

void bethHide(void) {
	if (bethWindow == nil) return;
	[bethWindow orderOut:nil];
	bethHidden = 1;
}

void bethInspect(void) {
	if (bethWeb == nil) return;
	// O WebKit só mostra o inspetor quando o processo foi lançado com isso.
	setenv("WEBKIT_INSPECTOR_SERVER", "127.0.0.1:9223", 0);
	[[NSUserDefaults standardUserDefaults] setBool:YES forKey:@"WebKitDeveloperExtras"];
	if (@available(macOS 13.3, *)) {
		SEL sel = NSSelectorFromString(@"_inspector");
		if ([bethWeb respondsToSelector:sel]) {
			id inspector = ((id (*)(id, SEL))[bethWeb methodForSelector:sel])(bethWeb, sel);
			SEL show = NSSelectorFromString(@"show");
			if ([inspector respondsToSelector:show]) {
				((void (*)(id, SEL))[inspector methodForSelector:show])(inspector, show);
				return;
			}
		}
	}
	NSLog(@"beth inspect: o WebKit desta versão não abriu o inspetor");
}

void bethStop(void) {
	bethAllowClose = 1;
	[NSApp terminate:nil];
}

int bethIsHidden(void) { return bethHidden; }

@interface BethTrayTarget : NSObject
- (void)open:(id)sender;
- (void)quitTray:(id)sender;
- (void)killAll:(id)sender;
- (void)inspect:(id)sender;
@end

@implementation BethTrayTarget
- (void)open:(id)sender { goTrayOpen(); }
- (void)quitTray:(id)sender { goTrayQuit(); }
- (void)killAll:(id)sender { goTrayKill(); }
- (void)inspect:(id)sender { goTrayInspect(); }
@end

static NSStatusItem *bethStatus = nil;
static BethTrayTarget *bethTrayTarget = nil;

void bethTrayInit(void) {
	bethEnsureApp();
	bethTrayTarget = [BethTrayTarget new];
	NSStatusItem *item = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
	NSImage *logo = bethMenuIcon();
	if (logo != nil) {
		item.button.image = logo;
		item.button.imagePosition = NSImageOnly;
		item.button.title = @"";
	} else {
		item.button.title = @"Beth";
	}
	NSMenu *menu = [[NSMenu alloc] init];
	NSMenuItem *open = [[NSMenuItem alloc] initWithTitle:@"Beth Studio" action:@selector(open:) keyEquivalent:@""];
	[open setTarget:bethTrayTarget];
	[menu addItem:open];
	NSMenuItem *inspect = [[NSMenuItem alloc] initWithTitle:@"Inspecionar (console)" action:@selector(inspect:) keyEquivalent:@""];
	[inspect setTarget:bethTrayTarget];
	[menu addItem:inspect];
	[menu addItem:[NSMenuItem separatorItem]];
	NSMenuItem *quit = [[NSMenuItem alloc] initWithTitle:@"Sair da bandeja (terminais continuam)" action:@selector(quitTray:) keyEquivalent:@""];
	[quit setTarget:bethTrayTarget];
	[menu addItem:quit];
	NSMenuItem *kill = [[NSMenuItem alloc] initWithTitle:@"Encerrar tudo (fecha os terminais)" action:@selector(killAll:) keyEquivalent:@""];
	[kill setTarget:bethTrayTarget];
	[menu addItem:kill];
	item.menu = menu;
	bethStatus = item;
}

int bethAsk(const char *text, const char *title) {
	NSAlert *alert = [[NSAlert alloc] init];
	[alert setMessageText:[NSString stringWithUTF8String:title]];
	[alert setInformativeText:[NSString stringWithUTF8String:text]];
	[alert addButtonWithTitle:@"Encerrar"];
	[alert addButtonWithTitle:@"Cancelar"];
	[alert setAlertStyle:NSAlertStyleWarning];
	return [alert runModal] == NSAlertFirstButtonReturn ? 1 : 0;
}

// Seletor de pasta (NSOpenPanel). NULL = cancelou; quem chama libera com free.
// Corre na thread principal (o handler HTTP do Go vem de outra).
char *bethPickFolder(const char *initial) {
	__block char *out = NULL;
	void (^run)(void) = ^{
		NSOpenPanel *panel = [NSOpenPanel openPanel];
		[panel setCanChooseFiles:NO];
		[panel setCanChooseDirectories:YES];
		[panel setAllowsMultipleSelection:NO];
		[panel setCanCreateDirectories:YES];
		[panel setResolvesAliases:YES];
		[panel setTitle:@"Escolher pasta inicial"];
		[panel setPrompt:@"Selecionar pasta"];
		[panel setMessage:@"Pasta em que o terminal abre"];
		if (initial != NULL && initial[0] != '\0') {
			NSString *path = [NSString stringWithUTF8String:initial];
			if (path.length > 0) {
				[panel setDirectoryURL:[NSURL fileURLWithPath:path isDirectory:YES]];
			}
		}
		NSInteger resp = [panel runModal];
		if (resp != NSModalResponseOK) return;
		NSURL *url = [[panel URLs] firstObject];
		if (url == nil) return;
		NSString *picked = [url path];
		if (picked.length == 0) return;
		out = strdup([picked UTF8String]);
	};
	if ([NSThread isMainThread]) {
		run();
	} else {
		dispatch_sync(dispatch_get_main_queue(), run);
	}
	return out;
}
