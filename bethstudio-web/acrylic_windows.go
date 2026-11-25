//go:build windows

package main

// Acrylic na barra lateral (Windows): o material do DWM fica atrás da
// janela; a página deixa só a sidebar transparente. Sem liquid glass —
// os botões da página ficam só meio translúcidos (CSS .bt-acrylic).

import (
	"log"
	"sync/atomic"
	"unsafe"

	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

var (
	procSetWindowCompositionAttribute = user32.NewProc("SetWindowCompositionAttribute")
	dwmapiDLL                         = windows.NewLazySystemDLL("dwmapi.dll")
	procDwmSetWindowAttribute         = dwmapiDLL.NewProc("DwmSetWindowAttribute")
)

const (
	wcaAccentPolicy = 19

	accentDisabled                = 0
	accentEnableAcrylicBlurBehind = 4

	dwmwaSystemBackdropType = 38
	dwmsbtNone              = 1
	dwmsbtTransientWindow   = 3 // Acrylic (Win11+)

	// Tint ABGR escuro (~60% opaco) sobre o blur.
	acrylicTintABGR = 0x99202020
)

type accentPolicy struct {
	AccentState   uint32
	AccentFlags   uint32
	GradientColor uint32
	AnimationId   uint32
}

type windowCompositionAttrData struct {
	Attribute  uint32
	Data       unsafe.Pointer
	SizeOfData uint32
}

// Cores opacas do tema (restauradas quando o acrylic desliga).
var (
	hostBgR, hostBgG, hostBgB uint8 = 24, 24, 24
	acrylicOn                 atomic.Bool
)

func rememberHostBackground(r, g, b uint8) {
	hostBgR, hostBgG, hostBgB = r, g, b
}

func setWebViewClear(clear bool) {
	if hostChromium == nil {
		return
	}
	c2 := hostChromium.GetController().GetICoreWebView2Controller2()
	if c2 == nil {
		return
	}
	if clear {
		_ = c2.PutDefaultBackgroundColor(edge.COREWEBVIEW2_COLOR{A: 0, R: 0, G: 0, B: 0})
		return
	}
	_ = c2.PutDefaultBackgroundColor(edge.COREWEBVIEW2_COLOR{A: 255, R: hostBgR, G: hostBgG, B: hostBgB})
}

func trySystemBackdrop(hwnd uintptr, on bool) bool {
	if procDwmSetWindowAttribute.Find() != nil {
		return false
	}
	v := uint32(dwmsbtNone)
	if on {
		v = dwmsbtTransientWindow
	}
	r, _, _ := procDwmSetWindowAttribute.Call(hwnd, dwmwaSystemBackdropType, uintptr(unsafe.Pointer(&v)), 4)
	return r == 0
}

func setAccentAcrylic(hwnd uintptr, on bool) {
	if procSetWindowCompositionAttribute.Find() != nil {
		return
	}
	accent := accentPolicy{}
	if on {
		accent.AccentState = accentEnableAcrylicBlurBehind
		accent.AccentFlags = 2
		accent.GradientColor = acrylicTintABGR
	} else {
		accent.AccentState = accentDisabled
	}
	data := windowCompositionAttrData{
		Attribute:  wcaAccentPolicy,
		Data:       unsafe.Pointer(&accent),
		SizeOfData: uint32(unsafe.Sizeof(accent)),
	}
	_, _, _ = procSetWindowCompositionAttribute.Call(hwnd, uintptr(unsafe.Pointer(&data)))
}

// setHostAcrylic liga/desliga o material atrás da janela. A página decide
// o que fica transparente (só a sidebar).
func setHostAcrylic(on bool) {
	h := hostHwnd
	if h == 0 {
		return
	}
	was := acrylicOn.Swap(on)
	if was == on {
		setWebViewClear(on)
		return
	}
	if trySystemBackdrop(h, on) {
		log.Printf("acrylic: SystemBackdrop (Win11) = %v", on)
	} else {
		setAccentAcrylic(h, on)
		log.Printf("acrylic: AccentPolicy = %v", on)
	}
	setWebViewClear(on)
}

func acrylicCommand(msg string) bool {
	switch msg {
	case "win:acrylic:1":
		setHostAcrylic(true)
		return true
	case "win:acrylic:0":
		setHostAcrylic(false)
		return true
	}
	return false
}
