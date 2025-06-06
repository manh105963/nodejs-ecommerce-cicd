const bcrypt = require('bcrypt');
const { ObjectId } = require('mongodb');
const db = require('../config/connection');
const collection = require('../config/collections');
const Razorpay = require('razorpay');
const { createHmac } = require('crypto');

const instance = new Razorpay({
  key_id: 'rzp_test_OXCuCZZpXXMT30',
  key_secret: 'OOg6baqHOLDxImnWSgqpePoP',
});

module.exports = {
  // Đăng ký người dùng
  doSignup: (userData) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Kiểm tra xem email đã tồn tại chưa
        let existingUser = await db.get().collection(collection.USER_COLLECTION).findOne({ Email: userData.Email });
        if (existingUser) {
          return reject({ message: 'Email already in use' });
        }

        // Mã hóa mật khẩu
        userData.Password = await bcrypt.hash(userData.Password, 10);

        // Xóa trường ConfirmPassword nếu có (đảm bảo không lưu vào DB)
        if (userData.ConfirmPassword) {
          delete userData.ConfirmPassword;
        }

        // Lưu dữ liệu người dùng vào cơ sở dữ liệu
        const result = await db.get().collection(collection.USER_COLLECTION).insertOne(userData);

        // Thêm _id vào userData để trả về
        userData._id = result.insertedId;
        resolve(userData);
      } catch (error) {
        reject(error);
      }
    });
  },

  // Đăng nhập người dùng
  doLogin: (userData) => {
    return new Promise(async (resolve, reject) => {
      try {
        let response = {};
        let user = await db.get().collection(collection.USER_COLLECTION).findOne({ Email: userData.Email });

        if (user) {
          const status = await bcrypt.compare(userData.Password, user.Password);
          if (status) {
            console.log("Login success");
            response.user = user;
            response.status = true;
            resolve(response);
          } else {
            console.log("Login failed: Incorrect password");
            resolve({ status: false });
          }
        } else {
          console.log("Login failed: User not found");
          resolve({ status: false });
        }
      } catch (error) {
        reject(error);
      }
    });
  },

  // Thêm sản phẩm vào giỏ hàng
  addToCart: (proId, userId) => {
    let proObj = {
      item: new ObjectId(proId),
      quantity: 1,
    };

    return new Promise(async (resolve, reject) => {
      try {
        let userCart = await db.get().collection(collection.CART_COLLECTION).findOne({ user: new ObjectId(userId) });

        if (userCart) {
          let proExist = userCart.products.findIndex(product => product.item.toString() === proId.toString());

          if (proExist !== -1) {
            // Sản phẩm đã tồn tại, tăng số lượng
            await db.get().collection(collection.CART_COLLECTION).updateOne(
              { user: new ObjectId(userId), 'products.item': new ObjectId(proId) },
              { $inc: { 'products.$.quantity': 1 } }
            );
            resolve();
          } else {
            // Sản phẩm chưa tồn tại, thêm mới vào mảng products
            await db.get().collection(collection.CART_COLLECTION).updateOne(
              { user: new ObjectId(userId) },
              { $push: { products: proObj } }
            );
            resolve();
          }
        } else {
          // Tạo giỏ hàng mới nếu chưa có
          let cartObj = {
            user: new ObjectId(userId),
            products: [proObj],
          };
          await db.get().collection(collection.CART_COLLECTION).insertOne(cartObj);
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    });
  },

  // Lấy danh sách sản phẩm trong giỏ hàng
  getCartProducts: (userId) => {
    return new Promise(async (resolve, reject) => {
      try {
        let cartItems = await db.get().collection(collection.CART_COLLECTION).aggregate([
          { $match: { user: new ObjectId(userId) } },
          { $unwind: '$products' },
          {
            $project: {
              item: '$products.item',
              quantity: '$products.quantity',
            },
          },
          {
            $lookup: {
              from: collection.PRODUCT_COLLECTION,
              localField: 'item',
              foreignField: '_id',
              as: 'product',
            },
          },
          {
            $project: {
              item: 1,
              quantity: 1,
              product: { $arrayElemAt: ['$product', 0] },
            },
          },
        ]).toArray();

        resolve(cartItems);
      } catch (error) {
        reject(error);
      }
    });
  },

  // Lấy số lượng sản phẩm trong giỏ hàng
  getCartCount: (userId) => {
    return new Promise(async (resolve, reject) => {
      try {
        let count = 0;
        let cart = await db.get().collection(collection.CART_COLLECTION).findOne({ user: new ObjectId(userId) });
        if (cart) {
          count = cart.products.length;
        }
        resolve(count);
      } catch (error) {
        reject(error);
      }
    });
  },

  // Thay đổi số lượng sản phẩm trong giỏ hàng
  changeProductQuantity: (details) => {
    details.count = parseInt(details.count);
    details.quantity = parseInt(details.quantity);

    return new Promise(async (resolve, reject) => {
      try {
        if (details.count === -1 && details.quantity === 1) {
          // Xóa sản phẩm nếu số lượng giảm xuống 0
          await db.get().collection(collection.CART_COLLECTION).updateOne(
            { _id: new ObjectId(details.cart) },
            { $pull: { products: { item: new ObjectId(details.product) } } }
          );
          resolve({ removeProduct: true });
        } else {
          // Cập nhật số lượng sản phẩm
          await db.get().collection(collection.CART_COLLECTION).updateOne(
            { _id: new ObjectId(details.cart), 'products.item': new ObjectId(details.product) },
            { $inc: { 'products.$.quantity': details.count } }
          );
          resolve({ status: true });
        }
      } catch (error) {
        reject(error);
      }
    });
  },

  // Xóa sản phẩm khỏi giỏ hàng
  removeCartItem: (cartId, proId) => {
    return new Promise(async (resolve, reject) => {
      try {
        await db.get().collection(collection.CART_COLLECTION).updateOne(
          { _id: new ObjectId(cartId) },
          { $pull: { products: { item: new ObjectId(proId) } } }
        );
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  },

  // Tính tổng số tiền trong giỏ hàng
  getTotalAmount: (userId) => {
    return new Promise(async (resolve, reject) => {
      try {
        let cartItems = await db.get().collection(collection.CART_COLLECTION).aggregate([
          { $match: { user: new ObjectId(userId) } },
          { $unwind: '$products' },
          {
            $project: {
              item: '$products.item',
              quantity: '$products.quantity',
            },
          },
          {
            $lookup: {
              from: collection.PRODUCT_COLLECTION,
              localField: 'item',
              foreignField: '_id',
              as: 'product',
            },
          },
          {
            $project: {
              item: 1,
              quantity: 1,
              product: { $arrayElemAt: ['$product', 0] },
            },
          },
          {
            $project: {
              item: 1,
              quantity: 1,
              productPrice: {
                $toDouble: {
                  $replaceAll: {
                    input: '$product.Price',
                    find: ',',
                    replacement: '',
                  },
                },
              },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: { $multiply: ['$quantity', '$productPrice'] } },
            },
          },
        ]).toArray();

        resolve(cartItems[0]?.total || 0);
      } catch (error) {
        reject(error);
      }
    });
  },

  // Đặt hàng
  placeOrder: (order, products, total) => {
    return new Promise(async (resolve, reject) => {
      try {
        let status = order['payment-method'] === 'COD' ? 'placed' : 'pending';
        let orderObj = {
          deliveryDetails: {
            mobile: order.mobile,
            address: order.address,
            pincode: order.pincode,
          },
          userId: new ObjectId(order.userId),
          paymentMethod: order['payment-method'],
          products: products,
          totalAmount: total,
          status: status,
          date: new Date(),
        };

        const response = await db.get().collection(collection.ORDER_COLLECTION).insertOne(orderObj);
        await db.get().collection(collection.CART_COLLECTION).deleteOne({ user: new ObjectId(order.userId) });
        resolve(response.insertedId);
      } catch (error) {
        reject(error);
      }
    });
  },

  // Lấy danh sách sản phẩm trong giỏ hàng để đặt hàng
  getCartProductList: (userId) => {
    return new Promise(async (resolve, reject) => {
      try {
        let cart = await db.get().collection(collection.CART_COLLECTION).findOne({ user: new ObjectId(userId) });
        if (cart && cart.products) {
          resolve(cart.products);
        } else {
          resolve([]);
        }
      } catch (error) {
        reject(error);
      }
    });
  },

  // Lấy danh sách đơn hàng của người dùng
  getUserOrders: (userId) => {
    return new Promise(async (resolve, reject) => {
      try {
        let orders = await db.get().collection(collection.ORDER_COLLECTION).find({ userId: new ObjectId(userId) }).toArray();
        resolve(orders);
      } catch (error) {
        reject(error);
      }
    });
  },

  // Lấy danh sách sản phẩm trong đơn hàng
  getOrderProducts: (orderId) => {
    return new Promise(async (resolve, reject) => {
      try {
        let orderItems = await db.get().collection(collection.ORDER_COLLECTION).aggregate([
          { $match: { _id: new ObjectId(orderId) } },
          { $unwind: '$products' },
          {
            $project: {
              item: '$products.item',
              quantity: '$products.quantity',
            },
          },
          {
            $lookup: {
              from: collection.PRODUCT_COLLECTION,
              localField: 'item',
              foreignField: '_id',
              as: 'product',
            },
          },
          {
            $project: {
              item: 1,
              quantity: 1,
              product: { $arrayElemAt: ['$product', 0] },
            },
          },
        ]).toArray();

        resolve(orderItems);
      } catch (error) {
        reject(error);
      }
    });
  },

  // Tạo đơn hàng Razorpay
  generateRazorpay: (orderId, total) => {
    return new Promise((resolve, reject) => {
      const options = {
        amount: total * 100, // Razorpay expects amount in paise
        currency: "INR",
        receipt: orderId.toString(),
      };

      instance.orders.create(options, (err, order) => {
        if (err) {
          console.error("Razorpay order creation failed:", err);
          reject(err);
        } else {
          console.log("Razorpay order created:", order);
          resolve(order);
        }
      });
    });
  },

  // Xác minh thanh toán Razorpay
  varifypayment: (payment) => {
    return new Promise((resolve, reject) => {
      const secret = 'OOg6baqHOLDxImnWSgqpePoP';
      let razorpayOrderId = payment.razorpay_order_id;
      let razorpayPaymentId = payment.razorpay_payment_id;
      let razorpaySignature = payment.razorpay_signature;

      let hash = createHmac('sha256', secret)
        .update(razorpayOrderId + '|' + razorpayPaymentId)
        .digest('hex');

      if (hash === razorpaySignature) {
        resolve();
      } else {
        reject(new Error('Invalid signature'));
      }
    });
  },

  // Thay đổi trạng thái thanh toán
  changePaymentStatus: (orderId) => {
    return new Promise(async (resolve, reject) => {
      try {
        await db.get().collection(collection.ORDER_COLLECTION).updateOne(
          { _id: new ObjectId(orderId) },
          { $set: { status: 'placed' } }
        );
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  },

  // Lấy danh sách tất cả người dùng
  getAllUsers: () => {
    return new Promise(async (resolve, reject) => {
      try {
        const users = await db.get().collection(collection.USER_COLLECTION).find().toArray();
        resolve(users);
      } catch (error) {
        reject(error);
      }
    });
  },

  // Lấy thông tin chi tiết người dùng
  getUserDetails: (userId) => {
    return new Promise(async (resolve, reject) => {
      try {
        let user = await db.get().collection(collection.USER_COLLECTION).findOne({ _id: new ObjectId(userId) });
        resolve(user);
      } catch (error) {
        reject(error);
      }
    });
  },

  // Xóa tài khoản người dùng
  deleteUserAccount: (userId) => {
    return new Promise(async (resolve, reject) => {
      try {
        await db.get().collection(collection.USER_COLLECTION).deleteOne({ _id: new ObjectId(userId) });
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  },

  // Thay đổi mật khẩu
  changePassword: (userId, currentPassword, newPassword) => {
    return new Promise(async (resolve, reject) => {
      try {
        let user = await db.get().collection(collection.USER_COLLECTION).findOne({ _id: new ObjectId(userId) });
        if (user) {
          const passwordMatch = await bcrypt.compare(currentPassword, user.Password);
          if (passwordMatch) {
            const hashedNewPassword = await bcrypt.hash(newPassword, 10);
            await db.get().collection(collection.USER_COLLECTION).updateOne(
              { _id: new ObjectId(userId) },
              { $set: { Password: hashedNewPassword } }
            );
            resolve(true);
          } else {
            resolve(false);
          }
        } else {
          resolve(false);
        }
      } catch (error) {
        reject(error);
      }
    });
  },
};