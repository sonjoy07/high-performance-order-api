import { NextFunction, Request, Response } from 'express';
import { AuthenticationError } from '../../common/errors/app.error';
import {
  orderReportQuerySchema,
  productReportQuerySchema,
  revenueReportQuerySchema,
} from './report.validation';
import { ReportService, reportService as defaultReportService } from './report.service';

export class ReportController {
  constructor(private readonly service: ReportService = defaultReportService) {}

  /** GET /api/v1/reports/orders */
  public orderSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const query = orderReportQuerySchema.parse(req.query);
      const report = await this.service.getOrderSummary(query);

      res.status(200).json({
        success: true,
        data: report,
      });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/v1/reports/orders/status-summary */
  public statusSummary = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const query = orderReportQuerySchema.parse(req.query);
      const report = await this.service.getStatusSummary(query);

      res.status(200).json({
        success: true,
        data: report,
      });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/v1/reports/revenue */
  public revenue = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const query = revenueReportQuerySchema.parse(req.query);
      const report = await this.service.getRevenueReport(query);

      res.status(200).json({
        success: true,
        data: report,
      });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/v1/reports/products */
  public products = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const query = productReportQuerySchema.parse(req.query);
      const report = await this.service.getProductSalesReport(query);

      res.status(200).json({
        success: true,
        data: report,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const reportController = new ReportController();