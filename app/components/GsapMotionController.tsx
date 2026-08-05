'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

const ENTER_SELECTOR = [
  '[data-gsap-enter="true"]',
  '.workspace-popover-panel',
  '.workspace-menu-panel',
  '.workspace-error-banner',
  '.agent-progress-enter',
].join(',');

const INTERACTIVE_SELECTOR = [
  '[data-gsap-interactive="true"]',
  '[data-gsap-hover-root="true"]',
  'button:not([data-gsap-no-interaction="true"])',
  'a[href]',
  '.workspace-surface-card',
  '.workspace-light-icon-button',
  '.workspace-black-button',
  '.workspace-primary-button',
  '.workspace-dark-icon-button',
  '.workspace-gallery-card',
  '.workspace-rail-item',
  '.workspace-history-card',
  '.workspace-menu-item',
  '.workspace-control-chip',
  '.workspace-reference-token',
  '.workspace-chat-icon-control',
  '.workspace-bottom-toolbar-item',
  '.workspace-add-button',
].join(',');

const LOOP_SELECTOR = '.gsap-spin,.gsap-pulse,.gsap-bounce';
const CANVAS_MOTION_EXCLUSION_SELECTOR =
  '[data-canvas="true"],[data-canvas-overlay-root="true"],[data-gsap-motion-exclude="true"]';

function isCanvasMotionTarget(element: Element) {
  return Boolean(element.closest(CANVAS_MOTION_EXCLUSION_SELECTOR));
}

function findInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element) || isCanvasMotionTarget(target)) return null;
  return target.closest<HTMLElement>(INTERACTIVE_SELECTOR);
}

function isDisabled(element: HTMLElement) {
  return element.matches(':disabled,[aria-disabled="true"],.is-disabled');
}

function ownsRootTransform(element: HTMLElement) {
  return element.dataset.gsapTransformOwner === 'canvas';
}

function getHoverScale(element: HTMLElement) {
  if (element.dataset.gsapNoScale === 'true') return 1;
  if (element.getAttribute('aria-pressed') === 'true') {
    const pressedScale = Number.parseFloat(element.dataset.gsapPressedScale || '1.04');
    return Number.isFinite(pressedScale) ? pressedScale : 1.04;
  }
  const configured = Number.parseFloat(element.dataset.gsapHoverScale || '');
  if (Number.isFinite(configured)) return configured;
  if (element.classList.contains('workspace-gallery-card') || element.classList.contains('workspace-history-card')) {
    return 1.012;
  }
  return 1.018;
}

export default function GsapMotionController() {
  const animatedElementsRef = useRef(new Set<HTMLElement>());

  useGSAP((_, contextSafe) => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduceMotion = motionQuery.matches;
    const initializedLoops = new Set<HTMLElement>();

    const registerTarget = (element: HTMLElement) => {
      animatedElementsRef.current.add(element);
      return element;
    };

    const initializeLoop = contextSafe((element: HTMLElement) => {
      if (initializedLoops.has(element)) return;
      initializedLoops.add(element);
      registerTarget(element);

      if (reduceMotion) {
        gsap.set(element, { clearProps: 'transform,opacity,visibility' });
        return;
      }

      if (element.classList.contains('gsap-spin')) {
        gsap.to(element, {
          rotation: 360,
          duration: Number.parseFloat(element.dataset.gsapDuration || '0.85'),
          ease: 'none',
          repeat: -1,
          force3D: true,
        });
        return;
      }

      if (element.classList.contains('gsap-bounce')) {
        gsap.to(element, {
          y: -4,
          duration: 0.34,
          delay: Number.parseFloat(element.dataset.gsapDelay || '0'),
          ease: 'sine.inOut',
          repeat: -1,
          yoyo: true,
          force3D: true,
        });
        return;
      }

      gsap.to(element, {
        autoAlpha: 0.42,
        duration: Number.parseFloat(element.dataset.gsapDuration || '0.9'),
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
    });

    const initializeTree = contextSafe((root: ParentNode) => {
      if (root instanceof Element && isCanvasMotionTarget(root)) return;
      const loopElements = [
        ...(root instanceof HTMLElement && root.matches(LOOP_SELECTOR) ? [root] : []),
        ...Array.from(root.querySelectorAll<HTMLElement>(LOOP_SELECTOR)),
      ].filter((element) => !isCanvasMotionTarget(element));
      loopElements.forEach(initializeLoop);
      const expandedControls = [
        ...(root instanceof HTMLElement && root.matches('[aria-expanded]') ? [root] : []),
        ...Array.from(root.querySelectorAll<HTMLElement>('[aria-expanded]')),
      ].filter((element) => !isCanvasMotionTarget(element));
      expandedControls.forEach((control) => {
        const chevron = control.querySelector<HTMLElement>('[data-gsap-chevron="true"]');
        if (!chevron) return;
        registerTarget(chevron);
        gsap.set(chevron, { rotation: control.getAttribute('aria-expanded') === 'true' ? 180 : 0 });
      });
      const pressedControls = [
        ...(root instanceof HTMLElement && root.matches('[aria-pressed]') ? [root] : []),
        ...Array.from(root.querySelectorAll<HTMLElement>('[aria-pressed]')),
      ].filter((element) => !isCanvasMotionTarget(element));
      pressedControls.forEach((control) => {
        const pressedScale = Number.parseFloat(control.dataset.gsapPressedScale || '1.04');
        registerTarget(control);
        gsap.set(control, { scale: control.getAttribute('aria-pressed') === 'true' ? pressedScale : 1 });
      });

      if (reduceMotion) return;
      const enterElements = [
        ...(root instanceof HTMLElement && root.matches(ENTER_SELECTOR) ? [root] : []),
        ...Array.from(root.querySelectorAll<HTMLElement>(ENTER_SELECTOR)),
      ].filter((element) => !isCanvasMotionTarget(element));
      enterElements.forEach((element) => {
        registerTarget(element);
        gsap.fromTo(
          element,
          { autoAlpha: 0, y: 7, scale: 0.985 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.18,
            ease: 'power2.out',
            overwrite: 'auto',
            force3D: true,
          }
        );
      });
    });

    const killTree = (root: ParentNode) => {
      const targets = [
        ...(root instanceof HTMLElement ? [root] : []),
        ...Array.from(root.querySelectorAll<HTMLElement>(`${ENTER_SELECTOR},${INTERACTIVE_SELECTOR},${LOOP_SELECTOR}`)),
      ];
      targets.forEach((element) => {
        gsap.killTweensOf(element);
        animatedElementsRef.current.delete(element);
        initializedLoops.delete(element);
      });
    };

    const animateHover = contextSafe((element: HTMLElement, active: boolean) => {
      if (reduceMotion || isDisabled(element)) return;
      registerTarget(element);
      if (!ownsRootTransform(element)) {
        gsap.to(element, {
          scale: active ? getHoverScale(element) : 1,
          y: active && element.classList.contains('workspace-history-card') ? -2 : 0,
          duration: active ? 0.16 : 0.2,
          ease: active ? 'power2.out' : 'power3.out',
          overwrite: 'auto',
          force3D: true,
        });
      }
      const revealTargets = Array.from(element.querySelectorAll<HTMLElement>('[data-gsap-hover-reveal="true"]'));
      if (revealTargets.length > 0) {
        if (active) {
          revealTargets.forEach((target) => {
            if (target.dataset.gsapHoverPointer === 'true') gsap.set(target, { pointerEvents: 'auto' });
          });
        }
        revealTargets.forEach((target) => {
          const mobileVisible = target.dataset.gsapMobileVisible === 'true' && window.matchMedia('(max-width: 639px)').matches;
          const inverted = target.dataset.gsapInvertReveal === 'true';
          const visible = inverted ? !active : active || mobileVisible;
          gsap.to(target, {
            autoAlpha: visible ? 1 : 0,
            y: visible ? 0 : 4,
            duration: 0.16,
            ease: 'power2.out',
            overwrite: 'auto',
            onComplete: () => {
              if (!visible && target.dataset.gsapHoverPointer === 'true') {
                gsap.set(target, { pointerEvents: 'none' });
              }
            },
          });
        });
      }
      const shiftTargets = Array.from(element.querySelectorAll<HTMLElement>('[data-gsap-hover-shift]'));
      shiftTargets.forEach((target) => {
        const amount = Number.parseFloat(target.dataset.gsapHoverShift || '-18');
        gsap.to(target, {
          y: active ? amount : 0,
          duration: 0.2,
          ease: 'power2.out',
          overwrite: 'auto',
          force3D: true,
        });
      });
      const shiftXTargets = Array.from(element.querySelectorAll<HTMLElement>('[data-gsap-hover-x]'));
      shiftXTargets.forEach((target) => {
        const amount = Number.parseFloat(target.dataset.gsapHoverX || '2');
        gsap.to(target, {
          x: active ? amount : 0,
          duration: 0.18,
          ease: 'power2.out',
          overwrite: 'auto',
          force3D: true,
        });
      });
      const alphaTargets = Array.from(element.querySelectorAll<HTMLElement>('[data-gsap-hover-alpha]'));
      alphaTargets.forEach((target) => {
        const [restingValue, activeValue] = (target.dataset.gsapHoverAlpha || '0,1')
          .split(',')
          .map((value) => Number.parseFloat(value));
        gsap.to(target, {
          autoAlpha: active ? (activeValue ?? 1) : (restingValue ?? 0),
          duration: 0.16,
          ease: 'power2.out',
          overwrite: 'auto',
        });
      });
      const scaleTargets = Array.from(element.querySelectorAll<HTMLElement>('[data-gsap-hover-scale]'));
      scaleTargets.forEach((target) => {
        const scale = Number.parseFloat(target.dataset.gsapHoverScale || '1.03');
        gsap.to(target, {
          scale: active ? scale : 1,
          duration: 0.2,
          ease: 'power2.out',
          overwrite: 'auto',
          force3D: true,
        });
      });
    });

    const handlePointerOver = (event: PointerEvent) => {
      const element = findInteractiveTarget(event.target);
      if (!element || element.contains(event.relatedTarget as Node | null)) return;
      animateHover(element, true);
    };
    const handlePointerOut = (event: PointerEvent) => {
      const element = findInteractiveTarget(event.target);
      if (!element || element.contains(event.relatedTarget as Node | null)) return;
      animateHover(element, false);
    };
    const handlePointerDown = contextSafe((event: PointerEvent) => {
      const element = findInteractiveTarget(event.target);
      if (!element || reduceMotion || isDisabled(element) || ownsRootTransform(element)) return;
      registerTarget(element);
      gsap.to(element, { scale: 0.965, duration: 0.09, ease: 'power2.out', overwrite: 'auto', force3D: true });
    });
    const handlePointerUp = (event: PointerEvent) => {
      const element = findInteractiveTarget(event.target);
      if (element) animateHover(element, element.matches(':hover'));
    };
    const handleFocusIn = (event: FocusEvent) => {
      const element = findInteractiveTarget(event.target);
      if (element) animateHover(element, true);
    };
    const handleFocusOut = (event: FocusEvent) => {
      const element = findInteractiveTarget(event.target);
      if (element) animateHover(element, false);
    };

    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.type === 'attributes' && record.target instanceof HTMLElement) {
          if (isCanvasMotionTarget(record.target)) return;
          if (record.attributeName === 'aria-pressed') {
            const pressedScale = Number.parseFloat(record.target.dataset.gsapPressedScale || '1.04');
            registerTarget(record.target);
            gsap.to(record.target, {
              scale: record.target.getAttribute('aria-pressed') === 'true' ? pressedScale : 1,
              duration: reduceMotion ? 0 : 0.16,
              ease: 'power2.out',
              overwrite: 'auto',
              force3D: true,
            });
            return;
          }
          const chevron = record.target.querySelector<HTMLElement>('[data-gsap-chevron="true"]');
          if (chevron) {
            registerTarget(chevron);
            gsap.to(chevron, {
              rotation: record.target.getAttribute('aria-expanded') === 'true' ? 180 : 0,
              duration: reduceMotion ? 0 : 0.18,
              ease: 'power2.out',
              overwrite: 'auto',
              force3D: true,
            });
          }
          return;
        }
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) initializeTree(node);
        });
        record.removedNodes.forEach((node) => {
          if (node instanceof HTMLElement) killTree(node);
        });
      });
    });

    const handleMotionPreference = () => {
      reduceMotion = motionQuery.matches;
      animatedElementsRef.current.forEach((element) => {
        gsap.killTweensOf(element);
        gsap.set(element, { clearProps: 'transform,opacity,visibility' });
      });
      initializedLoops.clear();
      if (!reduceMotion) initializeTree(document.body);
    };

    initializeTree(document.body);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'aria-pressed'],
    });
    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', handlePointerUp, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    motionQuery.addEventListener('change', handleMotionPreference);

    return () => {
      observer.disconnect();
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointerout', handlePointerOut, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('pointercancel', handlePointerUp, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      motionQuery.removeEventListener('change', handleMotionPreference);
      animatedElementsRef.current.forEach((element) => gsap.killTweensOf(element));
      animatedElementsRef.current.clear();
    };
  }, []);

  return null;
}
