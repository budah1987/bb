/* shadcn/ui-derived */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Drawer as DrawerPrimitive } from "vaul";

import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useStandaloneCompactPwa } from "@/hooks/useStandaloneCompactPwa";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "min(90vw, 320px)";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_GROUP_LABEL_BASE_CLASS =
  "duration-200 flex shrink-0 items-center rounded-md px-1 text-xs font-medium text-sidebar-foreground/75 outline-none ring-sidebar-ring transition-[margin,opa] ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0";
const SIDEBAR_GROUP_LABEL_COLLAPSED_CLASS =
  "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0";

type SidebarMobileWidthStyle = React.CSSProperties & {
  "--sidebar-width-mobile": string;
};

const sidebarMobileWidthStyle: SidebarMobileWidthStyle = {
  "--sidebar-width-mobile": SIDEBAR_WIDTH_MOBILE,
};

type SidebarContext = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  suppressMobileOpenAnimation: boolean;
  setSuppressMobileOpenAnimation: (suppress: boolean) => void;
  suppressMobileCloseAnimation: boolean;
  setSuppressMobileCloseAnimation: (suppress: boolean) => void;
  isCompactViewport: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContext | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

function useIsSidebarShowing() {
  const { state, isCompactViewport, openMobile } = useSidebar();
  return isCompactViewport ? openMobile : state === "expanded";
}

function useOptionalIsSidebarShowing() {
  const context = React.useContext(SidebarContext);
  if (context === null) {
    return null;
  }
  return context.isCompactViewport
    ? context.openMobile
    : context.state === "expanded";
}

/**
 * Stable callback that closes the mobile sidebar drawer. Every navigation
 * triggered from inside the sidebar must call this so the destination view is
 * revealed on compact viewports; on wider viewports the drawer state is
 * already closed and the call is a no-op.
 */
function useCloseMobileSidebar() {
  const { setOpenMobile } = useSidebar();
  return React.useCallback(() => setOpenMobile(false), [setOpenMobile]);
}

const SidebarProvider = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }
>(
  (
    {
      defaultOpen = true,
      open: openProp,
      onOpenChange: setOpenProp,
      className,
      style,
      children,
      ...props
    },
    ref,
  ) => {
    const isCompactViewport = useIsCompactViewport();
    const [openMobile, setOpenMobile] = React.useState(false);
    const [suppressMobileOpenAnimation, setSuppressMobileOpenAnimation] =
      React.useState(false);
    const [suppressMobileCloseAnimation, setSuppressMobileCloseAnimation] =
      React.useState(false);

    React.useEffect(() => {
      if (openMobile) {
        setSuppressMobileCloseAnimation(false);
      } else {
        setSuppressMobileOpenAnimation(false);
      }
    }, [openMobile]);

    const [_open, _setOpen] = React.useState(defaultOpen);
    const open = openProp ?? _open;
    const setOpen = React.useCallback(
      (value: boolean | ((value: boolean) => boolean)) => {
        const openState = typeof value === "function" ? value(open) : value;
        if (setOpenProp) {
          setOpenProp(openState);
        } else {
          _setOpen(openState);
        }
      },
      [setOpenProp, open],
    );

    // Helper to toggle the sidebar.
    const toggleSidebar = React.useCallback(() => {
      return isCompactViewport
        ? setOpenMobile((open) => !open)
        : setOpen((open) => !open);
    }, [isCompactViewport, setOpen, setOpenMobile]);

    // We add a state so that we can do data-state="expanded" or "collapsed".
    // This makes it easier to style the sidebar with Tailwind classes.
    const state = open ? "expanded" : "collapsed";

    const contextValue = React.useMemo<SidebarContext>(
      () => ({
        state,
        open,
        setOpen,
        isCompactViewport,
        openMobile,
        setOpenMobile,
        suppressMobileOpenAnimation,
        setSuppressMobileOpenAnimation,
        suppressMobileCloseAnimation,
        setSuppressMobileCloseAnimation,
        toggleSidebar,
      }),
      [
        state,
        open,
        setOpen,
        isCompactViewport,
        openMobile,
        setOpenMobile,
        suppressMobileOpenAnimation,
        setSuppressMobileOpenAnimation,
        suppressMobileCloseAnimation,
        setSuppressMobileCloseAnimation,
        toggleSidebar,
      ],
    );

    return (
      <SidebarContext.Provider value={contextValue}>
        {/* Match the agent message action bar's tooltip timing (300ms open
            delay + Radix's default skip window) so sidebar icon tooltips feel
            the same instead of flashing instantly on hover. disableHoverableContent
            dismisses the tooltip the moment the pointer leaves the trigger, so it
            never lingers/floats while the mouse moves on. */}
        <TooltipProvider delayDuration={300} disableHoverableContent>
          <div
            style={
              {
                "--sidebar-width": SIDEBAR_WIDTH,
                "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
                ...style,
              } as React.CSSProperties
            }
            className={cn(
              // Fill the shell root (html/body/#root are height:100%) instead of
              // re-measuring the viewport. On iOS standalone, viewport units and
              // the safe-area insets disagree, and app.css clips the difference
              // into an unreachable band at the bottom of the screen.
              "group/sidebar-wrapper flex h-full min-h-0 w-full has-[[data-variant=inset]]:bg-sidebar",
              className,
            )}
            ref={ref}
            {...props}
          >
            {children}
          </div>
        </TooltipProvider>
      </SidebarContext.Provider>
    );
  },
);
SidebarProvider.displayName = "SidebarProvider";

const Sidebar = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    side?: "left" | "right";
    variant?: "sidebar" | "floating" | "inset";
    collapsible?: "offcanvas" | "icon" | "none";
  }
>(
  (
    {
      side = "left",
      variant = "sidebar",
      collapsible = "offcanvas",
      className,
      style,
      children,
      ...props
    },
    ref,
  ) => {
    const isStandaloneCompactPwa = useStandaloneCompactPwa();
    const {
      isCompactViewport,
      state,
      openMobile,
      setOpenMobile,
      suppressMobileOpenAnimation,
      setSuppressMobileOpenAnimation,
      suppressMobileCloseAnimation,
      setSuppressMobileCloseAnimation,
    } = useSidebar();
    const handleOpenMobileChange = React.useCallback(
      (nextOpen: boolean) => {
        if (nextOpen) {
          setSuppressMobileCloseAnimation(false);
        } else {
          setSuppressMobileOpenAnimation(false);
        }
        setOpenMobile(nextOpen);
      },
      [
        setOpenMobile,
        setSuppressMobileCloseAnimation,
        setSuppressMobileOpenAnimation,
      ],
    );
    const shouldSuppressMobileCloseAnimation =
      !openMobile && suppressMobileCloseAnimation;
    const mobilePanelMotionStyle = React.useMemo<
      React.CSSProperties | undefined
    >(() => {
      if (shouldSuppressMobileCloseAnimation) {
        return {
          transform:
            side === "left"
              ? "translate3d(-100%, 0, 0)"
              : "translate3d(100%, 0, 0)",
          transition: "none",
        };
      }

      return undefined;
    }, [shouldSuppressMobileCloseAnimation, side]);
    const mobileBackdropStyle = React.useMemo<
      React.CSSProperties | undefined
    >(() => {
      if (shouldSuppressMobileCloseAnimation) {
        return {
          opacity: 0,
          pointerEvents: "none",
          transition: "none",
        };
      }

      return undefined;
    }, [shouldSuppressMobileCloseAnimation]);

    if (collapsible === "none") {
      return (
        <div
          className={cn(
            "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
            className,
          )}
          ref={ref}
          style={style}
          {...props}
        >
          {children}
        </div>
      );
    }

    if (isCompactViewport) {
      return (
        <DrawerPrimitive.Root
          open={openMobile}
          onOpenChange={handleOpenMobileChange}
          direction={side}
          closeThreshold={0.25}
          dismissible
          modal
          shouldScaleBackground={false}
        >
          <DrawerPrimitive.Portal>
            <DrawerPrimitive.Overlay
              data-sidebar-mobile-backdrop=""
              data-testid="sidebar-mobile-backdrop"
              data-sidebar-suppress-open-animation={
                suppressMobileOpenAnimation ? "true" : undefined
              }
              className={cn(
                "fixed inset-0 z-40 data-[state=closed]:pointer-events-none [&[data-sidebar-suppress-open-animation=true][data-state=open]]:![animation:none]",
                isStandaloneCompactPwa
                  ? "bg-black/55 backdrop-blur-[1px]"
                  : "bg-black/80",
              )}
              style={mobileBackdropStyle}
            />
            <DrawerPrimitive.Content
              ref={ref}
              data-sidebar="panel"
              data-sidebar-state={openMobile ? "expanded" : "collapsed"}
              data-collapsible=""
              data-variant={variant}
              data-side={side}
              data-sidebar-suppress-open-animation={
                suppressMobileOpenAnimation ? "true" : undefined
              }
              className={cn(
                // Fixed: a percentage height would resolve against the short
                // initial containing block, so it reads the shell unit directly.
                "group fixed inset-y-0 z-40 flex h-(--bb-shell-height) w-(--sidebar-width-mobile) flex-col bg-sidebar text-sidebar-foreground outline-none",
                "[&[data-sidebar-suppress-open-animation=true][data-state=open]]:![animation:none]",
                side === "left" ? "left-0" : "right-0",
                variant === "floating" || variant === "inset"
                  ? "p-2"
                  : "border-border-seam shadow-2xl data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=right]:border-l",
                className,
              )}
              style={
                {
                  ...sidebarMobileWidthStyle,
                  ...style,
                  ...mobilePanelMotionStyle,
                } as SidebarMobileWidthStyle
              }
              {...props}
            >
              <DrawerPrimitive.Title className="sr-only">
                Sidebar
              </DrawerPrimitive.Title>
              <DrawerPrimitive.Description className="sr-only">
                Application navigation
              </DrawerPrimitive.Description>
              <div
                data-sidebar="sidebar"
                className="flex h-full w-full flex-col bg-sidebar pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
              >
                {children}
              </div>
            </DrawerPrimitive.Content>
          </DrawerPrimitive.Portal>
        </DrawerPrimitive.Root>
      );
    }

    return (
      <div
        ref={ref}
        className="group peer text-sidebar-foreground"
        data-state={state}
        data-collapsible={state === "collapsed" ? collapsible : ""}
        data-variant={variant}
        data-side={side}
      >
        {/* This is what handles the sidebar gap on desktop */}
        <div
          data-sidebar="gap"
          className={cn(
            "relative hidden h-full w-(--sidebar-width) bg-transparent transition-[width] duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)] md:block",
            "group-data-[collapsible=offcanvas]:w-0",
            "group-data-[side=right]:rotate-180",
            variant === "floating" || variant === "inset"
              ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]"
              : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
          )}
        />
        <div
          data-sidebar="panel"
          className={cn(
            // Fixed: a percentage height would resolve against the short
            // initial containing block, so it reads the shell unit directly.
            // The visibility leg hides the fully collapsed offcanvas panel
            // after the slide-out so its mounted rows stop painting (#1261);
            // the zero delay on expand shows it again immediately. The slide
            // itself keeps BBamir's 220ms drawer easing.
            "fixed inset-y-0 z-10 flex h-(--bb-shell-height) w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground [transition:left_220ms_cubic-bezier(0.32,0.72,0,1),right_220ms_cubic-bezier(0.32,0.72,0,1),width_220ms_cubic-bezier(0.32,0.72,0,1),visibility_0s_linear_0s]",
            "group-data-[collapsible=offcanvas]:invisible group-data-[collapsible=offcanvas]:[transition:left_220ms_cubic-bezier(0.32,0.72,0,1),right_220ms_cubic-bezier(0.32,0.72,0,1),width_220ms_cubic-bezier(0.32,0.72,0,1),visibility_0s_linear_220ms]",
            side === "left"
              ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
              : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
            // Adjust the padding for floating and inset variants.
            variant === "floating" || variant === "inset"
              ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4)_+2px)]"
              : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) border-border-seam group-data-[side=left]:border-r group-data-[side=right]:border-l",
            className,
          )}
          style={style}
          {...props}
        >
          <div
            data-sidebar="sidebar"
            className="flex h-full w-full flex-col bg-sidebar pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
          >
            {children}
          </div>
        </div>
      </div>
    );
  },
);
Sidebar.displayName = "Sidebar";

const SidebarTrigger = React.forwardRef<
  React.ComponentRef<typeof Button>,
  React.ComponentProps<typeof Button>
>(({ className, onClick, "aria-expanded": ariaExpanded, ...props }, ref) => {
  const { isCompactViewport, open, openMobile, toggleSidebar } = useSidebar();
  // The one app-level control that stays outside the travelling page surface in
  // the installed compact app, so it is also the one that must always be
  // thumb-sized there. Elsewhere it keeps the shared header-control geometry.
  const isStandaloneCompactPwa = useStandaloneCompactPwa();

  return (
    <Button
      ref={ref}
      data-sidebar="trigger"
      variant="ghost"
      size="icon"
      className={cn(
        COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
        isStandaloneCompactPwa && "h-11 w-11",
        className,
      )}
      aria-expanded={ariaExpanded ?? (isCompactViewport ? openMobile : open)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <Icon name="PanelLeft" />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
});
SidebarTrigger.displayName = "SidebarTrigger";

const SidebarInset = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"main">
>(({ className, ...props }, ref) => (
  <main
    ref={ref}
    data-sidebar="inset"
    className={cn(
      "relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background",
      "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow",
      className,
    )}
    {...props}
  />
));
SidebarInset.displayName = "SidebarInset";

const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  );
});
SidebarFooter.displayName = "SidebarFooter";

const SidebarContentElementContext =
  React.createContext<React.RefObject<HTMLDivElement | null> | null>(null);

/**
 * Ref object holding the sidebar's scrolling content element
 * (`SidebarContent`). The windowed thread list reads `.current` inside
 * effects to decide which rows sit near the scrollport. The ref object is
 * stable, so consuming it never re-renders; returns null outside a
 * `SidebarContent`.
 */
function useSidebarContentElementRef() {
  return React.useContext(SidebarContentElementContext);
}

const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, children, ...props }, ref) => {
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const setContentRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );

  return (
    <div
      ref={setContentRef}
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-contain group-data-[collapsible=icon]:overflow-hidden",
        className,
      )}
      {...props}
    >
      <SidebarContentElementContext.Provider value={contentRef}>
        {children}
      </SidebarContentElementContext.Provider>
    </div>
  );
});
SidebarContent.displayName = "SidebarContent";

export type SidebarStickyTierKind = "label" | "project" | "parent";

type SidebarStickyStackProps = React.ComponentProps<"div">;

interface SidebarStickyTierProps extends React.ComponentProps<"div"> {
  tier: SidebarStickyTierKind;
  // Depth among pinned parents (0 = first parent under the project/label).
  // Drives the CSS pin offset and z-index for the "parent" tier; the other
  // tiers are singular and ignore it.
  level?: number;
}

type SidebarStickyParentLevelStyle = React.CSSProperties & {
  "--bb-sidebar-sticky-parent-level": number;
};

const SidebarStickyStack = React.forwardRef<
  HTMLDivElement,
  SidebarStickyStackProps
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-sidebar="group"
      data-sidebar-sticky-stack=""
      className={cn("relative flex w-full min-w-0 flex-col", className)}
      {...props}
    />
  );
});
SidebarStickyStack.displayName = "SidebarStickyStack";

const SidebarStickyTier = React.forwardRef<
  HTMLDivElement,
  SidebarStickyTierProps
>(({ children, className, tier, level, style, ...props }, ref) => {
  const tierStyle =
    tier === "parent" && level !== undefined
      ? ({
          ...style,
          "--bb-sidebar-sticky-parent-level": level,
        } satisfies SidebarStickyParentLevelStyle)
      : style;
  return (
    <div
      ref={ref}
      {...props}
      style={tierStyle}
      data-sidebar={tier === "label" ? "group-label" : undefined}
      data-sidebar-sticky-tier={tier}
      className={cn(
        tier === "label" && SIDEBAR_GROUP_LABEL_BASE_CLASS,
        tier === "label" && SIDEBAR_GROUP_LABEL_COLLAPSED_CLASS,
        "bg-sidebar",
        className,
      )}
    >
      {children}
    </div>
  );
});
SidebarStickyTier.displayName = "SidebarStickyTier";

interface SidebarStickyGroupProps extends React.ComponentProps<"div"> {
  asChild?: boolean;
}

/**
 * The containing block for one sticky group: a sticky header tier plus its
 * collapsible body. CSS `position: sticky` only pushes a header out of the way
 * of the next one when each header is constrained by its own containing block —
 * sticky siblings that share a containing block pin at the same offset and
 * overlap instead. Every nesting level (section/label, project, parent thread,
 * worktree) wraps its header + body in one of these so the shove-out behavior
 * is structural, not per-tier boilerplate that a new tier can forget.
 *
 * Pass `asChild` to project the wrapper onto a caller-owned element (e.g. the
 * project tier's `<li>` SidebarMenuItem) instead of emitting a `<div>`.
 */
const SidebarStickyGroup = React.forwardRef<
  HTMLDivElement,
  SidebarStickyGroupProps
>(({ asChild = false, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-sidebar-sticky-group=""
      className={cn(className)}
      {...props}
    />
  );
});
SidebarStickyGroup.displayName = "SidebarStickyGroup";

const SidebarGroupContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-sidebar="group-content"
    className={cn("w-full text-sm", className)}
    {...props}
  />
));
SidebarGroupContent.displayName = "SidebarGroupContent";

const SidebarMenu = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    data-sidebar="menu"
    className={cn("flex w-full min-w-0 flex-col gap-1", className)}
    {...props}
  />
));
SidebarMenu.displayName = "SidebarMenu";

const SidebarMenuItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<"li">
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    data-sidebar="menu-item"
    className={cn("group/menu-item relative", className)}
    {...props}
  />
));
SidebarMenuItem.displayName = "SidebarMenuItem";

const SIDEBAR_MENU_BUTTON_CLASS =
  "flex h-8 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0";

const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean;
    tooltip?: string | React.ComponentProps<typeof TooltipContent>;
  }
>(({ asChild = false, tooltip, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  const { isCompactViewport, state } = useSidebar();

  const button = (
    <Comp
      ref={ref}
      data-sidebar="menu-button"
      className={cn(SIDEBAR_MENU_BUTTON_CLASS, className)}
      {...props}
    />
  );

  if (!tooltip) {
    return button;
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    };
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isCompactViewport}
        {...tooltip}
      />
    </Tooltip>
  );
});
SidebarMenuButton.displayName = "SidebarMenuButton";

const SidebarMenuSkeleton = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    showIcon?: boolean;
  }
>(({ className, showIcon = false, ...props }, ref) => {
  const skeletonId = React.useId();

  // Stable varied width between 50 to 90%.
  const width = React.useMemo(() => {
    let hash = 0;
    for (let index = 0; index < skeletonId.length; index += 1) {
      hash = (hash + skeletonId.charCodeAt(index) * (index + 1)) % 40;
    }
    return `${hash + 50}%`;
  }, [skeletonId]);

  return (
    <div
      ref={ref}
      data-sidebar="menu-skeleton"
      className={cn("rounded-md h-8 flex gap-2 px-2 items-center", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 flex-1 max-w-[--skeleton-width]"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  );
});
SidebarMenuSkeleton.displayName = "SidebarMenuSkeleton";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarStickyGroup,
  SidebarStickyStack,
  SidebarStickyTier,
  SidebarTrigger,
  useCloseMobileSidebar,
  useIsSidebarShowing,
  useOptionalIsSidebarShowing,
  useSidebar,
  useSidebarContentElementRef,
};
