const express = require("express");
const roadmapRouter = express.Router();
const { authenticateToken } = require("../../middlewares/jwt/jwt");
const { languageValidator } = require("../../middlewares/common/languageValidator");
const { createRoadmapColumn } = require("../../main/roadmap/createRoadmapColumn");
const { updateRoadmapColumn } = require("../../main/roadmap/updateRoadmapColumn");
const { deleteRoadmapColumn } = require("../../main/roadmap/deleteRoadmapColumn");
const { getRoadmapColumns } = require("../../main/roadmap/getRoadmapColumns");
const { addItemToRoadmap } = require("../../main/roadmap/addItemToRoadmap");
const { updateRoadmapItem } = require("../../main/roadmap/updateRoadmapItem");
const { removeItemFromRoadmap } = require("../../main/roadmap/removeItemFromRoadmap");
const { getRoadmapItems } = require("../../main/roadmap/getRoadmapItems");

/**
 * @description Create roadmap column
 */
roadmapRouter.post("/column/create", authenticateToken, languageValidator, async (req, res) => {
  const { columnData, lg } = req.body;
  const authData = { ...req.auth, lg };
  createRoadmapColumn(columnData, authData)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
        data: result,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Update roadmap column
 */
roadmapRouter.put("/column/update/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { columnData, lg } = req.body;
  const authData = { ...req.auth, lg };
  updateRoadmapColumn(id, columnData, authData)
    .then((data) => {
      const { statusCode, status, message } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Delete roadmap column
 */
roadmapRouter.delete("/column/delete/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  deleteRoadmapColumn(id, authData)
    .then((data) => {
      const { statusCode, status, message } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Get all roadmap columns
 */
roadmapRouter.post("/columns", authenticateToken, languageValidator, async (req, res) => {
  const lg = req.body.lg || 'en';
  const authData = { ...req.auth, lg };
  getRoadmapColumns(authData)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
        data: result,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Add item to roadmap
 */
roadmapRouter.post("/item/add", authenticateToken, languageValidator, async (req, res) => {
  const { itemData, lg } = req.body;
  const authData = { ...req.auth, lg };
  addItemToRoadmap(itemData, authData)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
        data: result,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Update roadmap item
 */
roadmapRouter.put("/item/update/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const { itemData, lg } = req.body;
  const authData = { ...req.auth, lg };
  updateRoadmapItem(id, itemData, authData)
    .then((data) => {
      const { statusCode, status, message } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Remove item from roadmap
 */
roadmapRouter.delete("/item/remove/:id", authenticateToken, languageValidator, async (req, res) => {
  const { id } = req.params;
  const lg = req.body.lg || req.query.lg || 'en';
  const authData = { ...req.auth, lg };
  removeItemFromRoadmap(id, authData)
    .then((data) => {
      const { statusCode, status, message } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

/**
 * @description Get all roadmap items
 */
roadmapRouter.post("/items", authenticateToken, languageValidator, async (req, res) => {
  const lg = req.body.lg || 'en';
  const authData = { ...req.auth, lg };
  getRoadmapItems(authData)
    .then((data) => {
      const { statusCode, status, message, result } = data;
      return res.status(statusCode).send({
        status: status,
        message: message,
        data: result,
      });
    })
    .catch((error) => {
      const { statusCode, status, message } = error;
      return res.status(statusCode).send({
        status: status,
        message: message,
      });
    });
});

module.exports = {
  roadmapRouter,
};
