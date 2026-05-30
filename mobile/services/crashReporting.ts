import { CONFIG } from '../constants/config';

interface ErrorReport {
    message: string;
    stack?: string;
    componentStack?: string;
    context?: Record<string, any>;
    timestamp: string;
    appVersion: string;
}

class CrashReporter {
    private initialized = false;

    init() {
        if (this.initialized) return;
        this.initialized = true;

        // Set up global error handlers (ErrorUtils is React Native only)
        if (typeof ErrorUtils !== 'undefined') {
            const originalHandler = ErrorUtils.getGlobalHandler();
            ErrorUtils.setGlobalHandler((error, isFatal) => {
                this.captureException(error, { isFatal });
                originalHandler(error, isFatal);
            });
        }

        // Capture unhandled promise rejections
        const originalRejectionHandler = (global as any).onunhandledrejection;
        (global as any).onunhandledrejection = (event: any) => {
            this.captureException(event?.reason || new Error('Unhandled Promise rejection'), {
                type: 'unhandledRejection',
            });
            if (originalRejectionHandler) originalRejectionHandler(event);
        };

        console.log('[CrashReporting] Initialized');
    }

    captureException(error: Error | unknown, context?: Record<string, any>) {
        const report = this.buildReport(error, context);

        // Log locally in dev
        if (CONFIG.IS_DEBUG) {
            console.error('[CrashReporting] Captured:', report.message, context);
        }

        // In production, this would send to Sentry/Crashlytics
        // For now, we store a breadcrumb trail
        this.storeBreadcrumb(report);
    }

    captureMessage(message: string, context?: Record<string, any>) {
        const report: ErrorReport = {
            message,
            context,
            timestamp: new Date().toISOString(),
            appVersion: CONFIG.APP_VERSION,
        };

        if (CONFIG.IS_DEBUG) {
            console.log('[CrashReporting] Message:', message, context);
        }

        this.storeBreadcrumb(report);
    }

    private buildReport(error: Error | unknown, context?: Record<string, any>): ErrorReport {
        const err = error instanceof Error ? error : new Error(String(error));
        return {
            message: err.message,
            stack: err.stack,
            context,
            timestamp: new Date().toISOString(),
            appVersion: CONFIG.APP_VERSION,
        };
    }

    private breadcrumbs: ErrorReport[] = [];

    private storeBreadcrumb(report: ErrorReport) {
        this.breadcrumbs.push(report);
        // Keep last 50 breadcrumbs
        if (this.breadcrumbs.length > 50) {
            this.breadcrumbs = this.breadcrumbs.slice(-50);
        }
    }

    getBreadcrumbs(): ErrorReport[] {
        return [...this.breadcrumbs];
    }
}

export const crashReporting = new CrashReporter();
